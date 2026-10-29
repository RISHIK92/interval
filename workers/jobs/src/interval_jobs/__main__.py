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
import os
import signal
import sys
import threading
import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import get_args

import httpx
import psycopg

from interval_db.generated import BetaGroup, Capability, RightsProfile
from interval_jobs.compose import (
    ai_gateway,
    database_url,
    files,
    github_app,
    model_job,
    ocr,
    queue_consumer,
    queue_for_enqueue,
    services,
    stage_units,
)
from interval_jobs.concept_vectors import embed_concepts
from interval_jobs.concepts.draft import DraftError, draft_concepts
from interval_jobs.concepts.graph import TOPICS, ConceptSeedError, parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.consumer import run_consumers
from interval_jobs.embedding_eval import MIN_POOL, MIN_RECALL, parse_queries
from interval_jobs.embedding_eval import EvalError as EmbeddingEvalError
from interval_jobs.embedding_eval import run_eval as run_embedding_eval
from interval_jobs.feed.notes import queue_polish
from interval_jobs.feed.precompute import (
    STARTERS,
    enqueue_recomputes,
    recompute_starter,
)
from interval_jobs.github.sync import enqueue_syncs
from interval_jobs.ingest.one import ingest_one
from interval_jobs.ingest.seeds import SeedError, load_seeds
from interval_jobs.invites import MAX_COUNT, display, issue_invites
from interval_jobs.link_check import check_links
from interval_jobs.link_health import queue_link_checks
from interval_jobs.path_proposer import propose
from interval_jobs.pipeline import BATCH_PREFIX, Pipeline
from interval_jobs.polling import enqueue_due
from interval_jobs.ports import ConceptCycleError, ModelError, Store
from interval_jobs.question_batches import collect, submit
from interval_jobs.question_trial import TrialError, run_trial, trial_moments
from interval_jobs.questions import PROMPT_VERSION as QUESTIONS_PROMPT_VERSION
from interval_jobs.ranking.scoring import BREAK_MINUTES
from interval_jobs.recalibration import recalibrate
from interval_jobs.segment import segment_item
from interval_jobs.tagging import TaggingError
from interval_jobs.tagging_eval import (
    MIN_DIFFICULTY,
    MIN_F1,
    EvalError,
    parse_labels,
    run_eval,
    run_shortlist_eval,
)
from interval_jobs.technologies import TechnologySeedError, parse_technologies
from interval_jobs.technology_suggestions import suggest_technologies
from interval_jobs.tracing import run_span, setup

# The owner's seed list (Q-P1-02), relative to where commands run: the repo root
# locally, /app in the worker image (which copies it to the same path).
SEED_FILE = Path("workers/jobs/seeds/sources.yaml")
CONCEPT_FILE = Path("workers/jobs/seeds/concepts.yaml")
TECHNOLOGY_FILE = Path("workers/jobs/seeds/technologies.yaml")


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
    links = commands.add_parser(
        "check-links",
        help="check that moment links land on their sections (P1-W6-S02)",
    )
    links.add_argument("--source-id", type=int)
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
    evaluate.add_argument(
        "--embedding-model",
        help="the concepts' Voyage model, for a decisions: model's shortlist",
    )
    vectors = commands.add_parser(
        "eval-embeddings",
        help="score an embedding model on owner-labelled queries (Q-P1-27)",
    )
    vectors.add_argument("--queries", type=Path, required=True)
    vectors.add_argument("--model", required=True, help="Voyage model id")
    vectors.add_argument("--min-recall", type=float, default=MIN_RECALL)
    vectors.add_argument("--min-pool", type=int, default=MIN_POOL)
    concept_vectors = commands.add_parser(
        "embed-concepts",
        help="embed each active concept for the tagging shortlist (changed ones only)",
    )
    concept_vectors.add_argument("--model", required=True, help="Voyage model id")
    shortlisted = commands.add_parser(
        "eval-shortlist",
        help="how many labelled concepts the tagging shortlist keeps (recall@K)",
    )
    shortlisted.add_argument("--labels", type=Path, required=True)
    shortlisted.add_argument(
        "--model", required=True, help="the concepts' Voyage model"
    )
    consume = commands.add_parser(
        "consume", help="run the ingestion pipeline's stages until stopped"
    )
    consume.add_argument(
        "--max-entries",
        type=int,
        help="take only each feed's newest N entries (a one-off local run)",
    )
    discover = commands.add_parser(
        "enqueue-discover", help="queue a poll of one or every active source"
    )
    discover.add_argument("--source-id", type=int)
    commands.add_parser(
        "enqueue-questions",
        help="queue question drafting for every tagged full-text moment (Q-1)",
    )
    commands.add_parser(
        "question-batches",
        help="collect finished question batches, then submit what needs doing "
        "(QUESTIONS_MODEL=batch:<model>, Q-P2-13)",
    )
    trial = commands.add_parser(
        "question-trial",
        help="draft and validate the first N target moments on QUESTIONS_MODEL="
        "batch:<model> and report, saving nothing to the bank (Q-P2-13)",
    )
    trial.add_argument("--limit", type=int, default=10)
    trial.add_argument(
        "--draft-batch",
        help="resume this submitted draft batch, one no trial has finished reading "
        "(its cost would be recorded twice)",
    )
    paths = commands.add_parser(
        "propose-paths",
        help="ask PATHS_MODEL for candidate topic paths and save them as drafts "
        "for review (§5F, Q-P2-24)",
    )
    paths.add_argument("--count", type=_path_count, default=10)
    commands.add_parser(
        "recalibrate-difficulty",
        help="refit question difficulty from answers and queue anomalies (Q-3)",
    )
    commands.add_parser(
        "spot-check-due",
        help="queue this week's question spot checks: 10%% sampled, plus flagged (Q-2)",
    )
    report = commands.add_parser(
        "question-report",
        help="the question bank's counts, pass rate and a sample to read (Q-1)",
    )
    report.add_argument("--sample", type=int, default=20)
    commands.add_parser(
        "poll-due", help="queue a poll of every source whose turn has come (ING-3)"
    )
    commands.add_parser(
        "check-links-due",
        help="queue this week's link health check of every item (P1-W6-S03)",
    )
    technologies = commands.add_parser(
        "load-technologies",
        help="sync the technology seed file (PER-4, P2-W12-S03)",
    )
    technologies.add_argument("--file", type=Path, default=TECHNOLOGY_FILE)
    commands.add_parser(
        "suggest-technologies",
        help="ask QUESTIONS_MODEL to map unclaimed packages, for review (P2-W12-S03)",
    )
    commands.add_parser(
        "sync-github-due",
        help="queue a read of each connected user's repositories, if active this week "
        "(P2-W12-S02)",
    )
    args = parser.parse_args(argv)
    setup()
    if args.command == "consume":
        # Long-running: each delivery is its own trace (consumer.py), not one span
        # open for the life of the process.
        _consume(args.max_entries)
        return
    # OPS-2: one trace per run of a one-off command.
    with run_span(args.command):
        _run(parser, args)


def _run(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.command == "recompute-due":
        # Q-P1-17: hourly. Users' recomputes go through the queue (one job each,
        # retried alone); starter feeds have no user and are cheap, so they run here.
        now = datetime.now(UTC)
        queue = queue_for_enqueue()
        with services() as s:
            queued = enqueue_recomputes(s.store, queue, now)
        # One commit per starter: its notes don't keep a user's recompute waiting
        # behind all 36 feeds.
        for topic, level in STARTERS:
            with services() as s:
                done = recompute_starter(s.store, topic, level, None, now)
            if os.environ.get("NOTES_MODEL"):
                # The consumer polishes the new notes (P1-W4-S06).
                queue_polish(queue, done.unpolished)
        print(
            json.dumps(
                {"queued": queued, "starter_feeds": len(STARTERS) * len(BREAK_MINUTES)}
            )
        )
        return

    if args.command == "poll-due":
        with services() as s:
            enqueued = enqueue_due(s.store, queue_for_enqueue(), datetime.now(UTC))
        print(json.dumps({"enqueued": enqueued}))
        return

    if args.command == "sync-github-due":
        with services() as s:
            queued = enqueue_syncs(s.store, queue_for_enqueue(), datetime.now(UTC))
        print(json.dumps({"queued": queued}))
        return

    if args.command == "check-links-due":
        with services() as s:
            queued = queue_link_checks(s.store, queue_for_enqueue(), datetime.now(UTC))
        print(json.dumps({"queued": queued}))
        return

    if args.command == "enqueue-discover":
        print(json.dumps({"enqueued": _enqueue_discover(args.source_id)}))
        return

    if args.command == "enqueue-questions":
        print(json.dumps({"enqueued": _enqueue_questions()}))
        return

    if args.command == "question-batches":
        _question_batches()
        return

    if args.command == "question-trial":
        with services() as s:
            try:
                moments = trial_moments(s.store, args.limit)
            except TrialError as error:
                sys.exit(f"question-trial: {error}")
        with model_job("QUESTIONS_MODEL") as job:
            if job is None or not job.model.startswith(BATCH_PREFIX):
                sys.exit("question-trial needs QUESTIONS_MODEL=batch:<model>")
            with job.gateway() as gateway:
                try:
                    report = run_trial(
                        gateway,
                        job.model.removeprefix(BATCH_PREFIX),
                        moments,
                        draft_batch=args.draft_batch,
                    )
                except TrialError as error:
                    sys.exit(f"question-trial: {error}")
        print(json.dumps(asdict(report), indent=2, default=str))
        return

    if args.command == "propose-paths":
        _propose_paths(args.count)
        return

    if args.command == "recalibrate-difficulty":
        # Q-3 (P2-W9-S08): weekly, from EventBridge Scheduler or the VM's
        # interval-recalibrate.timer.
        with services() as s:
            got = recalibrate(s.store.questions)
        print(json.dumps(asdict(got)))
        return

    if args.command == "spot-check-due":
        # Q-2: a random 10% of the week's new live questions, plus every flagged one.
        # EventBridge Scheduler or the VM's interval-spot-checks.timer runs it weekly.
        since = datetime.now(UTC) - timedelta(days=7)
        with services() as s:
            sampled, flagged = s.store.questions.queue_spot_checks(since, 0.1)
        print(json.dumps({"sampled": sampled, "flagged": flagged}))
        return

    if args.command == "question-report":
        with services() as s:
            summary = s.store.questions.summary(args.sample)
        decided = summary.counts.get("live", 0) + summary.counts.get("rejected", 0)
        print(
            json.dumps(
                {
                    "counts": summary.counts,
                    # Of the questions the validator decided, the share it agreed on.
                    "pass_rate": (
                        round(summary.counts.get("live", 0) / decided, 3)
                        if decided
                        else None
                    ),
                    "sample": [
                        {
                            "question_id": q.question_id,
                            "status": q.status,
                            "stem": q.draft.stem,
                            "options": list(q.draft.options),
                            "key": q.draft.correct,
                            "validator": q.validator_answer,
                            "citation": q.draft.citation,
                        }
                        for q in summary.sample
                    ],
                },
                indent=2,
            )
        )
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

    if args.command == "suggest-technologies":

        @contextmanager
        def stores() -> Generator[Store]:
            with services() as s:
                yield s.store

        with model_job("QUESTIONS_MODEL") as job:
            if job is None:
                sys.exit("QUESTIONS_MODEL isn't set")
            with job.gateway() as gateway:
                # One call per package, not the batch tier (Q-P2-42: reviewed).
                outcome = suggest_technologies(
                    stores, gateway, job.model.removeprefix("batch:")
                )
        print(json.dumps(asdict(outcome)))
        if outcome.stopped is not None:
            sys.exit(f"suggest-technologies stopped: {outcome.stopped}")
        return

    if args.command == "load-technologies":
        path = str(args.file)
        try:
            text = args.file.read_text(encoding="utf-8")
        except OSError as error:
            sys.exit(f"{path}: {error.strerror}")
        with services() as s:
            graph = s.store.concepts.state()
            if graph is None:
                sys.exit("no concept graph loaded: run load-concepts first")
            known = frozenset(c.slug for c in graph.concepts if not c.retired)
            try:
                version, seeds = parse_technologies(text, known, path)
            except TechnologySeedError as error:
                sys.exit(str(error))
            synced = s.store.technologies.sync_seed(seeds)
        print(json.dumps({"version": version, **asdict(synced)}))
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
                    args.embedding_model,
                )
        except (OSError, EvalError, TaggingError, ModelError) as error:
            sys.exit(str(error))
        print(json.dumps({"model": args.model, **asdict(report)}, default=str))
        if not report.passed:
            sys.exit(1)
        return

    if args.command == "embed-concepts":
        with services() as s, httpx.Client() as http:
            done = embed_concepts(ai_gateway(s.ai, http), s.store, args.model)
        print(json.dumps(asdict(done), default=str))
        if done.refused is not None:
            sys.exit(f"stopped: the {done.refused.scope} AI budget is spent")
        if done.failed is not None:
            sys.exit(f"stopped: {done.failed} (the batches before it are kept)")
        return

    if args.command == "eval-shortlist":
        try:
            labels = parse_labels(
                args.labels.read_text(encoding="utf-8"), str(args.labels)
            )
            with services() as s, httpx.Client() as http:
                shortlist_report = run_shortlist_eval(
                    ai_gateway(s.ai, http), args.model, s.store, labels
                )
        except (OSError, EvalError, ModelError) as error:
            sys.exit(str(error))
        print(json.dumps(asdict(shortlist_report), default=str))
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
        elif args.command == "check-links":
            result = dict(check_links(s.store.moments, s.fetcher, args.source_id))
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


def _consume(max_entries: int | None) -> None:
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
            model_job("NOTES_MODEL") as notes,
            model_job("QUESTIONS_MODEL") as questions,
        ):
            pipeline = Pipeline(
                units,
                queue,
                tagging=tagging,
                embedding=embedding,
                max_entries=max_entries,
                notes=notes,
                questions=questions,
                files=files(),
                ocr=ocr(),
                github=github_app(),
            )
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


def _path_count(value: str) -> int:
    count = int(value)
    if not 1 <= count <= 20:
        raise argparse.ArgumentTypeError("--count must be 1-20")
    return count


def _propose_paths(count: int) -> None:
    """§5F (P2-W10-S01): drafts for the owner to review on /admin/paths. Run by hand."""

    @contextmanager
    def unit() -> Generator[Store]:
        with services() as s:
            yield s.store

    with model_job("PATHS_MODEL") as job:
        if job is None:
            sys.exit("propose-paths needs PATHS_MODEL (Q-P2-25)")
        with job.gateway() as gateway:
            got = propose(unit, gateway, job.model, count)
    print(json.dumps(asdict(got), indent=2))


def _question_batches() -> None:
    """Q-P2-13: collect what finished, then submit the rest. EventBridge Scheduler or
    the VM's interval-question-batches.timer runs it every 30 minutes."""

    @contextmanager
    def unit() -> Generator[Store]:
        with services() as s:
            yield s.store

    with (
        model_job("QUESTIONS_MODEL") as job,
        # One run at a time (a VM timer and an EventBridge schedule can overlap a
        # slow run): two collections or submits at once would double up.
        psycopg.connect(database_url(), autocommit=True) as lock,
    ):
        if job is None or not job.model.startswith(BATCH_PREFIX):
            sys.exit("question-batches needs QUESTIONS_MODEL=batch:<model>")
        got = lock.execute(
            "select pg_try_advisory_lock(hashtext('question-batches'))"
        ).fetchone()
        if got is None or not got[0]:
            print(json.dumps({"skipped": "another run holds the lock"}))
            return
        model = job.model.removeprefix(BATCH_PREFIX)
        with job.gateway() as gateway:
            collected = collect(unit, gateway, model)
            submitted = submit(unit, gateway, model)
    print(json.dumps({"collected": asdict(collected), "submitted": asdict(submitted)}))


def _enqueue_questions() -> int:
    """Q-1 backfill: every target moment; drafting skips ones already done (AI-4)."""
    with services() as s:
        moments = s.store.questions.targets(None)
    queue = queue_for_enqueue()
    for moment_id in moments:
        queue.enqueue(
            "generate_questions",
            {"moment_id": moment_id, "attempt": 0, "broken": 0},
            idempotency_key=f"questions-{moment_id}-v{QUESTIONS_PROMPT_VERSION}",
        )
    return len(moments)


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
