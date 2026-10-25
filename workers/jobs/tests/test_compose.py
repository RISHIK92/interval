"""Composition root and unit of work (ADR-0012)."""

import os

import psycopg
import pytest

from interval_jobs.adapters.postgres import unit_of_work
from interval_jobs.compose import database_url

URL = os.environ.get("DATABASE_URL", "")
NAME = "uow-test-source"


def source_count() -> int:
    with psycopg.connect(URL) as conn:
        row = conn.execute(
            "select count(*) from source where name = %s", (NAME,)
        ).fetchone()
        assert row is not None
        return int(row[0])


def cleanup() -> None:
    with psycopg.connect(URL) as conn:
        conn.execute("delete from source where name = %s", (NAME,))


def upsert(store: object) -> None:
    from interval_jobs.adapters.postgres import PostgresStore

    assert isinstance(store, PostgresStore)
    store.sources.upsert(
        name=NAME,
        feed_url="https://uow.example.test/feed.xml",
        rights_profile="metadata_only",
        homepage=None,
    )


def test_unit_of_work_commits_on_success() -> None:
    try:
        with unit_of_work(URL) as store:
            upsert(store)
        assert source_count() == 1
    finally:
        cleanup()


@pytest.mark.parametrize("error", [RuntimeError("boom"), SystemExit(1)])
def test_unit_of_work_rolls_back_on_any_exit(error: BaseException) -> None:
    with pytest.raises(type(error)), unit_of_work(URL) as store:
        upsert(store)
        raise error
    assert source_count() == 0


def test_database_url_refuses_a_remote_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "DATABASE_URL", "postgres://u:p@localhost/db?host=prod.example.com"
    )
    monkeypatch.delenv("CI", raising=False)
    with pytest.raises(SystemExit, match="Refusing"):
        database_url()


def test_database_url_accepts_localhost(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db")
    monkeypatch.delenv("CI", raising=False)
    assert database_url() == "postgres://u:p@localhost:5432/db"


def test_database_url_accepts_an_explicitly_allowed_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@postgres:5432/interval")
    monkeypatch.setenv("ALLOWED_DB_HOSTS", "postgres")
    monkeypatch.delenv("CI", raising=False)
    assert database_url() == "postgres://u:p@postgres:5432/interval"


def test_allowed_hosts_do_not_open_other_hosts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@db.example.com:5432/interval")
    monkeypatch.setenv("ALLOWED_DB_HOSTS", "postgres")
    monkeypatch.delenv("CI", raising=False)
    with pytest.raises(SystemExit, match="Refusing"):
        database_url()


@pytest.mark.parametrize("entry", ["db.example.com", "10.0.0.5", "::1x:2"])
def test_allowlist_ignores_domains_and_addresses(
    monkeypatch: pytest.MonkeyPatch, entry: str
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        f"postgres://u:p@[{entry}]/x" if ":" in entry else f"postgres://u:p@{entry}/x",
    )
    monkeypatch.setenv("ALLOWED_DB_HOSTS", entry)
    monkeypatch.delenv("CI", raising=False)
    with pytest.raises(SystemExit, match="Refusing"):
        database_url()
