"""Worker CLI: argument handling and grant-capability on the in-memory store."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass

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
