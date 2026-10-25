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


def test_aws_runtime_accepts_the_rds_host(monkeypatch: pytest.MonkeyPatch) -> None:
    url = (
        "postgres://interval:pw@interval.abc.ap-south-1.rds.amazonaws.com:5432/interval"
    )
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("INTERVAL_RUNTIME", "aws")
    monkeypatch.delenv("CI", raising=False)
    assert database_url() == url


def test_other_runtime_values_do_not_open_the_guard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://u:p@db.example.com/x")
    monkeypatch.setenv("INTERVAL_RUNTIME", "vm")
    monkeypatch.delenv("CI", raising=False)
    with pytest.raises(SystemExit, match="Refusing"):
        database_url()


def test_the_file_event_transport_writes_to_events_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: object
) -> None:
    from pathlib import Path

    from interval_jobs.adapters.file_sink import FileEventSink
    from interval_jobs.compose import event_sink

    assert isinstance(tmp_path, Path)
    monkeypatch.setenv("EVENTS_TRANSPORT", "file")
    monkeypatch.setenv("EVENTS_DIR", str(tmp_path))
    assert isinstance(event_sink(), FileEventSink)


def test_the_firehose_event_transport_needs_a_stream_and_a_region(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from interval_jobs.adapters.firehose_sink import FirehoseEventSink
    from interval_jobs.compose import event_sink

    monkeypatch.setenv("EVENTS_TRANSPORT", "firehose")
    monkeypatch.delenv("EVENTS_STREAM", raising=False)
    with pytest.raises(SystemExit, match="EVENTS_STREAM"):
        event_sink()
    monkeypatch.setenv("EVENTS_STREAM", "interval-events")
    monkeypatch.setenv("AWS_REGION", "ap-south-1")
    assert isinstance(event_sink(), FirehoseEventSink)


def test_an_unknown_event_transport_stops_the_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from interval_jobs.compose import event_sink

    monkeypatch.setenv("EVENTS_TRANSPORT", "kafka")
    with pytest.raises(SystemExit, match="EVENTS_TRANSPORT"):
        event_sink()


# OPS-4: a model call is paid for when it returns. Its usage row must survive the job
# failing afterwards, or a job that keeps failing and retrying never reaches its budget.
def test_ai_usage_is_kept_when_the_unit_of_work_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: object
) -> None:
    from datetime import UTC, datetime
    from decimal import Decimal

    from interval_jobs.compose import services
    from interval_jobs.ports import Usage

    monkeypatch.setenv("EVENTS_TRANSPORT", "file")
    monkeypatch.setenv("EVENTS_DIR", str(tmp_path))
    model = "uow-test-model"
    try:
        with pytest.raises(RuntimeError), services() as s:
            s.ai.record(
                Usage(
                    user_id=None,
                    feature="tagging",
                    provider="openrouter",
                    model=model,
                    input_tokens=1,
                    output_tokens=1,
                    cost_usd=Decimal("0.01"),
                    occurred_at=datetime(2099, 1, 1, tzinfo=UTC),
                )
            )
            raise RuntimeError("the job failed after the model call")
        with psycopg.connect(URL) as conn:
            row = conn.execute(
                "select count(*) from ai_usage where model = %s", (model,)
            ).fetchone()
        assert row == (1,)
    finally:
        with psycopg.connect(URL) as conn:
            conn.execute("delete from ai_usage where model = %s", (model,))


# ADR-0014: BullMQ on Valkey locally and on the VM, SQS in the full-AWS mode.
def test_the_bullmq_transport_needs_valkey(monkeypatch: pytest.MonkeyPatch) -> None:
    from interval_jobs.adapters.bullmq_queue import BullmqConsumer, BullmqQueue
    from interval_jobs.compose import queue_consumer, queue_for_enqueue

    monkeypatch.setenv("QUEUE_TRANSPORT", "bullmq")
    monkeypatch.delenv("VALKEY_URL", raising=False)
    with pytest.raises(SystemExit, match="VALKEY_URL"):
        queue_consumer()
    monkeypatch.setenv("VALKEY_URL", "redis://localhost:6379")
    assert isinstance(queue_consumer(), BullmqConsumer)
    queue = queue_for_enqueue()
    assert isinstance(queue, BullmqQueue)
    queue.close()


def test_the_sqs_transport_needs_a_prefix_and_region(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from interval_jobs.adapters.sqs_queue import SqsConsumer, SqsQueue
    from interval_jobs.compose import queue_consumer, queue_for_enqueue

    monkeypatch.setenv("QUEUE_TRANSPORT", "sqs")
    monkeypatch.delenv("SQS_QUEUE_URL_PREFIX", raising=False)
    with pytest.raises(SystemExit, match="SQS_QUEUE_URL_PREFIX"):
        queue_for_enqueue()
    monkeypatch.setenv("SQS_QUEUE_URL_PREFIX", "https://sqs.example/123/interval-")
    monkeypatch.setenv("AWS_REGION", "ap-south-1")
    assert isinstance(queue_for_enqueue(), SqsQueue)
    assert isinstance(queue_consumer(), SqsConsumer)


def test_an_unknown_queue_transport_stops_the_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from interval_jobs.compose import queue_consumer

    monkeypatch.setenv("QUEUE_TRANSPORT", "elasticmq")
    with pytest.raises(SystemExit, match="QUEUE_TRANSPORT"):
        queue_consumer()
