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
