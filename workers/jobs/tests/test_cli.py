"""Worker CLI: argument handling and grant-capability on the in-memory store."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import pytest

from interval_jobs import __main__ as cli
from interval_jobs.__main__ import main
from interval_jobs.adapters.memory import InMemoryStore, StoredUser


@dataclass
class FakeServices:
    store: InMemoryStore


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
