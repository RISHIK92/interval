"""Worker CLI.

Usage:
  python -m interval_jobs ingest-one --name N --feed-url URL --rights-profile P
  python -m interval_jobs segment-item --content-item-id ID
  python -m interval_jobs recompute-due
  python -m interval_jobs issue-invites --group student --uses 30 --days 30 [--count N]
  python -m interval_jobs purge-guests
  python -m interval_jobs poll-due
  python -m interval_jobs load-concepts [--file F]
  python -m interval_jobs draft-concepts --topic T --model M --out F
  python -m interval_jobs eval-tagging --labels F --model M
  python -m interval_jobs eval-embeddings --queries F --model M
"""

import argparse
import json
import signal
import sys
import threading
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import get_args

import httpx

from interval_db.generated import BetaGroup, Capability, RightsProfile
from interval_jobs.compose import (
    ai_gateway,
    model_job,
    queue_consumer,
    queue_for_enqueue,
    services,
    stage_units,
)
from interval_jobs.concepts.draft import DraftError, draft_concepts
from interval_jobs.concepts.graph import TOPICS, ConceptSeedError, parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.consumer import run_consumers
from interval_jobs.embedding_eval import MIN_POOL, MIN_RECALL, parse_queries
from interval_jobs.embedding_eval import EvalError as EmbeddingEvalError
from interval_jobs.embedding_eval import run_eval as run_embedding_eval
from interval_jobs.feed.precompute import enqueue_recomputes, recompute_starters
from interval_jobs.ingest.one import ingest_one
from interval_jobs.ingest.seeds import SeedError, load_seeds
from interval_jobs.invites import MAX_COUNT, display, issue_invites
from interval_jobs.pipeline import Pipeline
from interval_jobs.polling import enqueue_due
from interval_jobs.ports import ConceptCycleError, ModelError
from interval_jobs.segment import segment_item
from interval_jobs.tagging import TaggingError
from interval_jobs.tagging_eval import (
    MIN_DIFFICULTY,
    MIN_F1,
    EvalError,
    parse_labels,
    run_eval,
)
from interval_jobs.tracing import run_span, setup

# The owner's seed list (Q-P1-02), relative to where commands run: the repo root
# locally, /app in the worker image (which copies it to the same path).
SEED_FILE = Path("workers/jobs/seeds/sources.yaml")
CONCEPT_FILE = Path("workers/jobs/seeds/concepts.yaml")


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="interval_jobs")
    commands = parser.add_subparsers(dest="command", required=True)
    one = commands.add_parser("ingest-one", help="ingest the newest item of one feed")
    one.add_argument("--name", required=True)
    one.add_argument("--feed-url", required=True)
    one.add_argument(
        "--rights-profile", required=True, choices=get_args(RightsProfile.__value__)
    )
    one.add_argument("--homepage")
    seg = commands.add_parser("segment-item", help="split one stored item into moments")
    seg.add_argument("--content-item-id", type=int, required=True)
    commands.add_parser(
        "recompute-due",
        help="queue a feed recompute per active user and refresh the starter feeds",
    )
    inv = commands.add_parser("issue-invites", help="issue private-beta invite codes")
    inv.add_argument("--group", required=True, choices=get_args(BetaGroup.__value__))
    inv.add_argument("--uses", type=int, required=True, help="1 = personal code")
    inv.add_argument("--days", type=int, required=True, help="valid for this many days")
    inv.add_argument("--count", type=int, default=1)
    inv.add_argument("--note")
    commands.add_parser("purge-guests", help="delete guests with no live session")
    grant = commands.add_parser(
        "grant-capability", help="give one account a capability beyond its plan"
    )
    grant.add_argument(
        "--email", required=True, help="an account's email; guests can't be granted"
    )
    grant.add_argument(
        "--capability", required=True, choices=get_args(Capability.__value__)
    )
    grant.add_argument("--revoke", action="store_true")
    load = commands.add_parser(
        "load-sources", help="sync the seed list file into the sources table"
    )
    load.add_argument("--file", type=Path, default=SEED_FILE)
    concepts = commands.add_parser(
        "load-concepts", help="sync the concept seed file into the concept graph"
    )
    concepts.add_argument("--file", type=Path, default=CONCEPT_FILE)
    draft = commands.add_parser(
        "draft-concepts",
        help="ask a model for candidate concepts and write them to a file for review",
    )
    draft.add_argument("--topic", required=True, choices=sorted(TOPICS))
    draft.add_argument("--count", type=_draft_count, default=20)
    draft.add_argument("--model", required=True, help="OpenRouter model id")
    draft.add_argument("--out", type=Path, required=True)
    draft.add_argument("--file", type=Path, default=CONCEPT_FILE)
    evaluate = commands.add_parser(
        "eval-tagging",
        help="score a tagging model against owner-labelled moments (AI-5)",
    )
    evaluate.add_argument("--labels", type=Path, required=True)
    evaluate.add_argument("--model", required=True, help="OpenRouter model id")
    evaluate.add_argument("--min-f1", type=float, default=MIN_F1)
    evaluate.add_argument("--min-difficulty", type=float, default=MIN_DIFFICULTY)
    vectors = commands.add_parser(
        "eval-embeddings",
        help="score an embedding model on owner-labelled queries (Q-P1-27)",
    )
    vectors.add_argument("--queries", type=Path, required=True)
    vectors.add_argument("--model", required=True, help="Voyage model id")
    vectors.add_argument("--min-recall", type=float, default=MIN_RECALL)
    vectors.add_argument("--min-pool", type=int, default=MIN_POOL)
    commands.add_parser(
        "consume", help="run the ingestion pipeline's stages until stopped"
    )
    discover = commands.add_parser(
        "enqueue-discover", help="queue a poll of one or every active source"
    )
    discover.add_argument("--source-id", type=int)
    commands.add_parser(
        "poll-due", help="queue a poll of every source whose turn has come (ING-3)"
    )
    args = parser.parse_args(argv)
    setup()
    if args.command == "consume":
        # Long-running: each delivery is its own trace (consumer.py), not one span
        # open for the life of the process.
        _consume()
        return
    # OPS-2: one trace per run of a one-off command.
    with run_span(args.command):
        _run(parser, args)


def _run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.command == "recompute-due":
        # Q-P1-17: hourly. Users' recomputes go through the queue (one job each,
        # retried alone); starter feeds have no user and are cheap, so they run here.
        now = datetime.now(UTC)
        with services() as s:
            queued = enqueue_recomputes(s.store, queue_for_enqueue(), now)
            starters = recompute_starters(s.store, None, now)
        print(json.dumps({"queued": queued, "starter_feeds": starters}))
        return

    if args.command == "poll-due":
        with services() as s:
            enqueued = enqueue_due(s.store, queue_for_enqueue(), datetime.now(UTC))
        print(json.dumps({"enqueued": enqueued}))
        return

    if args.command == "enqueue-discover":
        print(json.dumps({"enqueued": _enqueue_discover(args.source_id)}))
        return

    if args.command == "load-sources":
        path = str(args.file)
        try:
            text = args.file.read_text(encoding="utf-8")
        except OSError as error:
            sys.exit(f"{path}: {error.strerror}")
        try:
            with services() as s:
                synced, skipped = load_seeds(s.store.sources, text, path)
        except SeedError as error:
            sys.exit(str(error))
        print(json.dumps({**asdict(synced), "skipped_feedless": skipped}))
        return

    if args.command == "load-concepts":
        path = str(args.file)
        try:
            text = args.file.read_text(encoding="utf-8")
        except OSError as error:
            sys.exit(f"{path}: {error.strerror}")
        try:
            graph = parse_concepts(text, path)
            with services() as s:
                loaded = sync_concepts(s.store, graph)
        except (ConceptSeedError, ConceptCycleError) as error:
            sys.exit(str(error))
        print(json.dumps({"version": graph.version, **asdict(loaded)}))
        return

    if args.command == "draft-concepts":
        if args.out.resolve() in (args.file.resolve(), CONCEPT_FILE.resolve()):
            sys.exit("--out must not be the seed file: drafts are reviewed first")
        try:
            graph = parse_concepts(
                args.file.read_text(encoding="utf-8"), str(args.file)
            )
            with services() as s, httpx.Client() as http:
                text = draft_concepts(
                    ai_gateway(s.ai, http), graph, args.topic, args.count, args.model
                )
        except (
            OSError,
            ConceptSeedError,
            ConceptCycleError,
            DraftError,
            ModelError,
        ) as error:
            sys.exit(str(error))
        args.out.write_text(text, encoding="utf-8")
        print(json.dumps({"out": str(args.out)}))
        return

    if args.command == "eval-tagging":
        try:
            labels = parse_labels(
                args.labels.read_text(encoding="utf-8"), str(args.labels)
            )
            with services() as s, httpx.Client() as http:
                report = run_eval(
                    ai_gateway(s.ai, http),
                    args.model,
                    s.store,
                    labels,
                    args.min_f1,
                    args.min_difficulty,
                )
        except (OSError, EvalError, TaggingError, ModelError) as error:
            sys.exit(str(error))
        print(json.dumps({"model": args.model, **asdict(report)}, default=str))
        if not report.passed:
            sys.exit(1)
        return

    if args.command == "eval-embeddings":
        try:
            queries = parse_queries(
                args.queries.read_text(encoding="utf-8"), str(args.queries)
            )
            with services() as s, httpx.Client() as http:
                scored = run_embedding_eval(
                    ai_gateway(s.ai, http),
                    args.model,
                    s.store,
                    queries,
                    args.min_recall,
                    args.min_pool,
                )
        except (OSError, EmbeddingEvalError, ModelError) as error:
            sys.exit(str(error))
        print(json.dumps({"model": args.model, **asdict(scored)}, default=str))
        if not scored.passed:
            sys.exit(1)
        return

    if args.command == "grant-capability":
        with services() as s:
            grants = s.store.grants
            change = (grants.revoke if args.revoke else grants.grant)(
                args.email, args.capability
            )
        if change == "no_account":
            sys.exit(f"no account with email {args.email}")
        if change == "limited":
            sys.exit(
                f"{args.capability}: a plan limits it, so it comes from plans only"
            )
        # "revoked" removes the grant only; the user's plan may still include it.
        print(json.dumps({"result": change, "capability": args.capability}))
        return

    if args.command == "issue-invites":
        if args.uses < 1 or args.days < 1 or not 1 <= args.count <= MAX_COUNT:
            parser.error(f"--uses and --days must be >= 1; --count 1..{MAX_COUNT}")
        with services() as s:
            codes = issue_invites(
                s.store,
                group=args.group,
                uses=args.uses,
                days=args.days,
                count=args.count,
                note=args.note,
            )
        print("\n".join(display(code) for code in codes))
        return

    result: dict[str, object]
    with services() as s:
        if args.command == "purge-guests":
            result = {"purged": s.store.users.purge_inactive_guests(datetime.now(UTC))}
        elif args.command == "segment-item":
            rows = segment_item(s.store, args.content_item_id)
            result = {"content_item_id": args.content_item_id, "moments": len(rows)}
        else:
            source_id = s.store.sources.upsert(
                name=args.name,
                feed_url=args.feed_url,
                rights_profile=args.rights_profile,
                homepage=args.homepage,
            )
            ingested = ingest_one(s.store, s.fetcher, s.extractor, source_id)
            result = {
                "content_item_id": ingested.content_item_id,
                "stored": ingested.stored,
            }
    print(json.dumps(result))


# The health check in deploy/compose.prod.yml reads this file's age.
HEARTBEAT = Path("/tmp/interval-consumer-alive")


def _consume() -> None:
    stop = threading.Event()

    def request_stop(_signal: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    queue = queue_for_enqueue()
    try:
        with (
            stage_units() as units,
            model_job("TAGGING_MODEL") as tagging,
            model_job("EMBEDDING_MODEL") as embedding,
        ):
            pipeline = Pipeline(units, queue, tagging=tagging, embedding=embedding)
            run_consumers(queue_consumer(), pipeline.handlers(), stop, HEARTBEAT)
    finally:
        close = getattr(queue, "close", None)
        if callable(close):
            close()


def _draft_count(value: str) -> int:
    count = int(value)
    if not 1 <= count <= 50:
        raise argparse.ArgumentTypeError("count must be between 1 and 50")
    return count


def _enqueue_discover(source_id: int | None) -> int:
    if source_id is None:
        with services() as s:
            ids = s.store.sources.active_ids()
    else:
        ids = [source_id]
    queue = queue_for_enqueue()
    # One poll per source per minute: a repeated run within it is the same message.
    minute = int(time.time() // 60)
    for sid in ids:
        queue.enqueue(
            "discover_source",
            {"source_id": sid},
            idempotency_key=f"discover-{sid}-{minute}",
        )
    return len(ids)


if __name__ == "__main__":
    main(sys.argv[1:])
