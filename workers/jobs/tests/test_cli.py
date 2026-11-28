"""Worker CLI: argument handling and grant-capability on the in-memory store."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from interval_jobs import __main__ as cli
from interval_jobs.__main__ import main
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore, StoredUser
from interval_jobs.adapters.memory_queue import InMemoryQueue
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.pipeline import ModelJob
from interval_jobs.ports import FeedEntry
from interval_jobs.rewrite_stems import RewriteRun

from .test_pipeline import NoEmbeddings, TagLlm


@dataclass
class FakeServices:
    store: InMemoryStore

    @property
    def ai(self) -> InMemoryAi:
        return InMemoryAi(self.store.users)


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> InMemoryStore:
    memory = InMemoryStore()
    memory.users.rows["owner"] = StoredUser(
        "owner", is_anonymous=False, email="owner@example.test"
    )

    @contextmanager
    def services() -> Generator[FakeServices]:
        yield FakeServices(memory)

    monkeypatch.setattr(cli, "services", services)
    return memory


def run(capsys: pytest.CaptureFixture[str], *args: str) -> dict[str, object]:
    main(list(args))
    out: dict[str, object] = json.loads(capsys.readouterr().out)
    return out


def test_grant_capability_accepts_only_known_capabilities(
    capsys: pytest.CaptureFixture[str],
) -> None:
    # The choices come from the generated Capability enum (OPS-3).
    with pytest.raises(SystemExit) as exit_info:
        main(["grant-capability", "--email", "a@b.test", "--capability", "feed.write"])
    assert exit_info.value.code == 2
    assert "admin.review" in capsys.readouterr().err


def test_grant_then_revoke_reports_what_changed(
    store: InMemoryStore, capsys: pytest.CaptureFixture[str]
) -> None:
    grant = ["grant-capability", "--email", "owner@example.test"]
    assert run(capsys, *grant, "--capability", "admin.review") == {
        "result": "granted",
        "capability": "admin.review",
    }
    assert store.users.rows["owner"].capabilities == {"admin.review"}
    revoke = [*grant, "--capability", "admin.review", "--revoke"]
    assert run(capsys, *revoke)["result"] == "revoked"
    assert run(capsys, *revoke)["result"] == "not_granted"


@pytest.mark.parametrize(
    ("email", "capability", "message"),
    [
        ("nobody@example.test", "admin.review", "no account with email"),
        ("owner@example.test", "ai.notes.daily", "a plan limits it"),
    ],
)
def test_a_refused_grant_exits_non_zero(
    store: InMemoryStore, email: str, capability: str, message: str
) -> None:
    with pytest.raises(SystemExit, match=message):
        main(["grant-capability", "--email", email, "--capability", capability])


SEEDS = """\
- name: CLI Source
  feed_url: https://cli.example.test/feed
  rights_profile: full_text_internal
- name: CLI Newsletter
  rights_profile: metadata_only
"""


def test_load_sources_syncs_the_file_and_skips_feedless_sources(
    store: InMemoryStore, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    seeds = tmp_path / "sources.yaml"
    seeds.write_text(SEEDS, encoding="utf-8")
    main(["load-sources", "--file", str(seeds)])
    lines = capsys.readouterr().out.splitlines()
    result = json.loads(lines[-1])
    assert result == {
        "added": 1,
        "updated": 0,
        "unchanged": 0,
        "deactivated": 0,
        "skipped_feedless": 1,
    }
    skipped = [json.loads(line) for line in lines[:-1]]
    assert skipped[0]["msg"] == (
        "seeds: feedless source skipped; deactivated if it exists"
    )
    assert skipped[0]["name"] == "CLI Newsletter"


def test_load_sources_reports_a_bad_file_with_its_line(
    store: InMemoryStore, tmp_path: Path
) -> None:
    seeds = tmp_path / "sources.yaml"
    seeds.write_text(SEEDS.replace("full_text_internal", "full_text"), encoding="utf-8")
    with pytest.raises(SystemExit, match=rf"{seeds}:3: rights_profile"):
        main(["load-sources", "--file", str(seeds)])
    assert store.sources.rows == {}


def test_load_sources_defaults_to_the_repo_seed_file(
    store: InMemoryStore, capsys: pytest.CaptureFixture[str]
) -> None:
    main(["load-sources"])
    result = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert result["added"] == 67


def test_load_sources_reports_a_missing_file(
    store: InMemoryStore, tmp_path: Path
) -> None:
    missing = tmp_path / "nope.yaml"
    with pytest.raises(SystemExit, match=f"{missing}: "):
        main(["load-sources", "--file", str(missing)])


def test_a_source_that_loses_its_feed_is_deactivated(
    store: InMemoryStore, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    seeds = tmp_path / "sources.yaml"
    seeds.write_text(SEEDS, encoding="utf-8")
    main(["load-sources", "--file", str(seeds)])
    capsys.readouterr()
    seeds.write_text(
        SEEDS.replace("  feed_url: https://cli.example.test/feed\n", ""),
        encoding="utf-8",
    )
    main(["load-sources", "--file", str(seeds)])
    result = json.loads(capsys.readouterr().out.splitlines()[-1])
    # Owner choice: no feed, no polling; its row stays but is switched off.
    assert result["deactivated"] == 1
    assert result["skipped_feedless"] == 2
    assert [r.active for r in store.sources.rows.values()] == [False]


def test_enqueue_discover_queues_every_active_source(
    store: InMemoryStore,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from interval_jobs.adapters.memory_queue import InMemoryQueue

    queue = InMemoryQueue()
    monkeypatch.setattr(cli, "queue_for_enqueue", lambda: queue)
    store.sources.upsert(
        name="a", feed_url="https://a.test/f", rights_profile="excerpt", homepage=None
    )
    b = store.sources.upsert(
        name="b", feed_url="https://b.test/f", rights_profile="excerpt", homepage=None
    )
    store.sources.rows[b].active = False
    assert run(capsys, "enqueue-discover") == {"enqueued": 1}
    assert queue.pending("discover_source") == 1
    assert run(capsys, "enqueue-discover", "--source-id", str(b)) == {"enqueued": 1}


def test_load_concepts_syncs_the_repo_file_and_reports_counts(
    store: InMemoryStore, capsys: pytest.CaptureFixture[str]
) -> None:
    first = run(capsys, "load-concepts")
    assert first["changed"] is True
    loaded = store.concepts.state()
    assert loaded is not None and int(str(first["added"])) == len(loaded.concepts)
    assert run(capsys, "load-concepts")["changed"] is False


def test_load_concepts_reports_a_cycle_and_writes_nothing(
    store: InMemoryStore, tmp_path: Path
) -> None:
    looped = tmp_path / "concepts.yaml"
    looped.write_text(
        "version: 1\nconcepts:\n"
        "  - {slug: a, name: A, topic: backend, prerequisites: [b]}\n"
        "  - {slug: b, name: B, topic: backend, prerequisites: [a]}\n",
        encoding="utf-8",
    )
    with pytest.raises(SystemExit, match="prerequisite cycle"):
        main(["load-concepts", "--file", str(looped)])
    assert store.concepts.state() is None


def test_draft_concepts_writes_a_reviewable_file_never_the_seed_file(
    store: InMemoryStore,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    from interval_jobs.ai.gateway import AiGateway

    from .test_concept_draft import GOOD, NoEmbeddings, ScriptedLlm

    def fake_gateway(ledger: object, http: object) -> AiGateway:
        answer = GOOD.replace("replication-lag", "hinted-handoff")
        return AiGateway(InMemoryAi(store.users), ScriptedLlm(answer), NoEmbeddings())

    monkeypatch.setattr(cli, "ai_gateway", fake_gateway)
    out = tmp_path / "draft.yaml"
    args = ["draft-concepts", "--topic", "distributed-systems", "--model", "m"]
    main([*args, "--out", str(out)])
    lines = capsys.readouterr().out.splitlines()
    assert json.loads(lines[-1]) == {"out": str(out)}
    assert json.loads(lines[0])["msg"] == "ai: call"  # costed through the gateway
    assert "hinted-handoff" in out.read_text(encoding="utf-8")
    with pytest.raises(SystemExit, match="seed file"):
        main([*args, "--out", "workers/jobs/seeds/concepts.yaml"])
    other = tmp_path / "other.yaml"
    other.write_text("version: 1\nconcepts: []\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="seed file"):
        main([*args, "--file", str(other), "--out", "workers/jobs/seeds/concepts.yaml"])
    with pytest.raises(SystemExit):
        main([*args, "--count", "0", "--out", str(out)])


def test_the_eval_commands_print_a_report_and_fail_below_the_mark(
    store: InMemoryStore,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    from interval_jobs.ai.gateway import AiGateway

    from .test_embedding_eval import CRASH, INTRO, LOG, QUERIES, KeywordVoyage
    from .test_tagging import ScriptedLlm

    item = _articles(store, [LOG, CRASH, INTRO])[0]
    answer: dict[str, object] = {"item": {"difficulty": "beginner", "concepts": []}}

    def fake_gateway(ledger: object, http: object) -> AiGateway:
        return AiGateway(InMemoryAi(store.users), ScriptedLlm(answer), KeywordVoyage())

    monkeypatch.setattr(cli, "ai_gateway", fake_gateway)
    sync_concepts(
        store,
        parse_concepts(
            "version: 1\nconcepts:\n  - {slug: a, name: A, topic: backend}\n", "c.yaml"
        ),
    )
    queries = tmp_path / "queries.yaml"
    queries.write_text(QUERIES, encoding="utf-8")
    main(
        [
            "eval-embeddings",
            "--queries",
            str(queries),
            "--model",
            "voyage-3.5",
            "--min-pool",
            "3",
        ]
    )
    report = json.loads(capsys.readouterr().out.splitlines()[-1])
    # One vector per article (ADR-0058): three articles and the queries' call.
    assert report["mrr"] == 1.0 and report["cost_usd"] == "0.004"
    labels = tmp_path / "labels.yaml"
    labels.write_text(
        f'version: 1\nmoments:\n  - {{url: "{LOG}", moment: null,'
        " difficulty: advanced, concepts: [a]}\n",
        encoding="utf-8",
    )
    with pytest.raises(SystemExit) as failed:
        main(["eval-tagging", "--labels", str(labels), "--model", "m"])
    assert failed.value.code == 1  # below the pass mark, after printing the report
    assert json.loads(capsys.readouterr().out.splitlines()[-1])["passed"] is False
    assert store.tags.version(item) is None


def _articles(store: InMemoryStore, urls: list[str]) -> list[int]:
    sid = store.sources.upsert(
        name="eval",
        feed_url="https://e.test/f",
        rights_profile="full_text_internal",
        homepage=None,
    )
    items: list[int] = []
    for url, text in zip(
        urls, ("the log comes first", "after a crash", "intro text"), strict=True
    ):
        entry = FeedEntry(
            guid=url,
            link=url,
            title="T",
            author=None,
            published_at=None,
            updated_at=None,
            summary=None,
        )
        item = store.items.upsert_from_feed(sid, entry, keep_excerpt=False)
        store.items.store_full_text(item, text)
        items.append(item)
    return items


def test_poll_due_queues_due_sources_once(
    store: InMemoryStore,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from interval_jobs.adapters.memory_queue import InMemoryQueue

    queue = InMemoryQueue()
    monkeypatch.setattr(cli, "queue_for_enqueue", lambda: queue)
    store.sources.upsert(
        name="a", feed_url="https://a.test/f", rights_profile="excerpt", homepage=None
    )
    assert run(capsys, "poll-due") == {"enqueued": 1}
    assert run(capsys, "poll-due") == {"enqueued": 0}  # claimed until its next turn
    assert queue.pending("discover_source") == 1


def test_the_commands_run_through_python_dash_m() -> None:
    # The real entry point: the command's code must exist when main() runs. Without
    # queue settings it stops with the setup message, not a NameError.
    import os
    import subprocess
    import sys

    env = {k: v for k, v in os.environ.items() if k != "QUEUE_TRANSPORT"}
    result = subprocess.run(
        [sys.executable, "-m", "interval_jobs", "enqueue-discover", "--source-id", "1"],
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
        env=env,
    )
    assert "NameError" not in result.stderr
    assert "QUEUE_TRANSPORT must be bullmq or sqs" in result.stderr


def test_check_links_due_queues_every_item(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    memory = InMemoryStore()
    source_id = memory.sources.upsert(
        name="Blog",
        feed_url="https://blog.example.test/feed.xml",
        rights_profile="metadata_only",
        homepage=None,
    )
    for guid in ("a", "b"):
        memory.items.upsert_from_feed(
            source_id,
            FeedEntry(
                guid=guid,
                link=f"https://blog.example.test/{guid}",
                title=guid,
                author=None,
                published_at=None,
                updated_at=None,
                summary=None,
            ),
            keep_excerpt=False,
        )
    queue = InMemoryQueue()

    @contextmanager
    def services() -> Generator[FakeServices]:
        yield FakeServices(memory)

    monkeypatch.setattr(cli, "services", services)
    monkeypatch.setattr(cli, "queue_for_enqueue", lambda: queue)
    main(["check-links-due"])
    assert json.loads(capsys.readouterr().out) == {"queued": 2}
    assert queue.pending("check_link") == 2


def test_daily_challenge_due_prints_what_it_did(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    memory = InMemoryStore()

    @contextmanager
    def services() -> Generator[FakeServices]:
        yield FakeServices(memory)

    monkeypatch.setattr(cli, "services", services)
    main(["daily-challenge-due"])
    # The last line: the auto-publish's warning is logged first.
    assert json.loads(capsys.readouterr().out.splitlines()[-1]) == {
        "picked_today": True,
        "published_unreviewed": 0,
        "picked_tomorrow": True,
    }
    assert len(memory.daily.days) == 2


def test_prune_snapshots_needs_the_private_bucket(
    monkeypatch: pytest.MonkeyPatch, store: InMemoryStore
) -> None:
    """P5-W31-S04b-2: without a bucket the objects can't go, so nothing is forgotten.
    ADR-0046: Explore's questions past 30 days are purged first, bucket or not."""
    now = datetime.now(UTC)
    store.ask.asked_at["old"] = now - timedelta(days=31)
    store.ask.asked_at["recent"] = now - timedelta(days=29)
    monkeypatch.setattr(cli, "files", lambda: None)
    with pytest.raises(SystemExit, match="PRIVATE_CONTENT_BUCKET"):
        main(["prune-snapshots"])
    assert set(store.ask.asked_at) == {"recent"}


def test_rewrite_stems_needs_the_question_model_and_a_positive_limit(
    monkeypatch: pytest.MonkeyPatch, store: InMemoryStore
) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["rewrite-stems", "--limit", "0"])
    assert exit_info.value.code == 2

    @contextmanager
    def no_model(variable: str) -> Generator[None]:
        assert variable == "QUESTIONS_MODEL"
        yield None

    monkeypatch.setattr(cli, "model_job", no_model)
    with pytest.raises(SystemExit, match="QUESTIONS_MODEL"):
        main(["rewrite-stems"])
    with pytest.raises(SystemExit) as exit_info:
        main(["rewrite-stems", "--retry-days", "-1"])
    assert exit_info.value.code == 2


@pytest.mark.parametrize(
    ("errors", "stopped", "code"),
    [
        (0, None, None),
        # Model errors (an outage) finish the run, then exit 2 so they show.
        (3, None, 2),
        # A spent budget stops it, as before.
        (0, "the global AI budget is spent", "rewrite-stems stopped: the global AI "
         "budget is spent"),
    ],
)  # fmt: skip
def test_rewrite_stems_exits_non_zero_after_model_errors(
    monkeypatch: pytest.MonkeyPatch,
    store: InMemoryStore,
    capsys: pytest.CaptureFixture[str],
    errors: int,
    stopped: str | None,
    code: int | str | None,
) -> None:
    @contextmanager
    def gateway() -> Generator[AiGateway]:
        yield AiGateway(InMemoryAi(store.users), TagLlm(), NoEmbeddings())

    @contextmanager
    def a_model(variable: str) -> Generator[ModelJob]:
        yield ModelJob("batch:qwen-questions", gateway)

    asked: list[tuple[str, int | None, timedelta]] = []

    def fake_rewrite(
        stores: object,
        gateway: AiGateway,
        model: str,
        limit: int | None,
        *,
        retry_after: timedelta,
        now: datetime,
    ) -> RewriteRun:
        asked.append((model, limit, retry_after))
        return RewriteRun(1, 0, 0, errors, 0, 0, 0, 0, stopped)

    monkeypatch.setattr(cli, "model_job", a_model)
    monkeypatch.setattr(cli, "rewrite_stems", fake_rewrite)
    if code is None:
        main(["rewrite-stems", "--limit", "5", "--retry-days", "2"])
    else:
        with pytest.raises(SystemExit) as exit_info:
            main(["rewrite-stems", "--limit", "5", "--retry-days", "2"])
        assert exit_info.value.code == code
    # One call at a time (no batch tier), the limit and cool-off as given.
    assert asked == [("qwen-questions", 5, timedelta(days=2))]
    assert json.loads(capsys.readouterr().out)["errors"] == errors


def test_eval_ask_needs_both_models_and_its_questions(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """ADR-0046 (AI-5): the eval runs only with EMBEDDING_MODEL and ASK_MODEL set."""

    @contextmanager
    def no_model(variable: str) -> Generator[None]:
        assert variable in ("EMBEDDING_MODEL", "ASK_MODEL")
        yield None

    @contextmanager
    def no_units() -> Generator[None]:
        yield None

    monkeypatch.setattr(cli, "model_job", no_model)
    monkeypatch.setattr(cli, "stage_units", no_units)
    with pytest.raises(SystemExit, match="EMBEDDING_MODEL and ASK_MODEL"):
        main(["eval-ask", "--user-id", "u1"])
    with pytest.raises(SystemExit, match="No such file"):
        main(["eval-ask", "--user-id", "u1", "--questions", str(tmp_path / "none")])
