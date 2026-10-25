"""Worker CLI: argument handling and grant-capability on the in-memory store."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import pytest

from interval_jobs import __main__ as cli
from interval_jobs.__main__ import main
from interval_jobs.adapters.memory import InMemoryAi, InMemoryStore, StoredUser
from interval_jobs.concepts.graph import parse_concepts
from interval_jobs.concepts.sync import sync_concepts


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
  moments_enabled: true
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
    assert result["added"] == 10


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

    from .test_embedding_eval import QUERIES, URL, KeywordVoyage
    from .test_tagging import ScriptedLlm

    item = _item_with_moments(store, URL)
    answer: dict[str, object] = {
        "item": {"difficulty": "beginner", "concepts": []},
        "moments": [
            {"ordinal": o, "difficulty": "beginner", "concepts": []} for o in (0, 1, 2)
        ],
    }

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
    assert report["mrr"] == 1.0 and report["cost_usd"] == "0.002"
    labels = tmp_path / "labels.yaml"
    labels.write_text(
        f'version: 1\nmoments:\n  - {{url: "{URL}", moment: null,'
        " difficulty: advanced, concepts: [a]}\n",
        encoding="utf-8",
    )
    with pytest.raises(SystemExit) as failed:
        main(["eval-tagging", "--labels", str(labels), "--model", "m"])
    assert failed.value.code == 1  # below the pass mark, after printing the report
    assert json.loads(capsys.readouterr().out.splitlines()[-1])["passed"] is False
    assert store.tags.version(item) is None


def _item_with_moments(store: InMemoryStore, url: str) -> int:
    from interval_jobs.ports import FeedEntry, MomentRow

    sid = store.sources.upsert(
        name="eval",
        feed_url="https://e.test/f",
        rights_profile="full_text_internal",
        homepage=None,
    )
    store.sources.set_moments_enabled(sid, True)
    entry = FeedEntry(
        guid="e",
        link=url,
        title="T",
        author=None,
        published_at=None,
        updated_at=None,
        summary=None,
    )
    item = store.items.upsert_from_feed(sid, entry, keep_excerpt=False)
    store.items.store_full_text(
        item, "intro text\nWhy a log\nthe log comes first\nRecovery\nafter a crash"
    )
    store.moments.replace(
        item,
        [
            MomentRow(0, "T", 1, url, "page_top"),
            MomentRow(1, "Why a log", 1, f"{url}#a", "anchor"),
            MomentRow(2, "Recovery", 1, f"{url}#b", "anchor"),
        ],
    )
    return item


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
