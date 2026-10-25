import os
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


@pytest.fixture
def conn() -> Iterator[psycopg.Connection]:
    url = os.environ.get("DATABASE_URL")
    assert url, "DATABASE_URL is not set; copy .env.example to .env"
    # Each test runs inside an explicit outer transaction that is always rolled back, so
    # nested `transaction()` blocks in adapters become savepoints and never commit.
    with (
        psycopg.connect(url) as connection,
        connection.transaction(force_rollback=True),
    ):
        yield connection


# The global tracer provider can be set once per process; set it before any code under
# test does, keeping spans in memory (interval_jobs.tracing leaves it in place).
_EXPORTER = InMemorySpanExporter()
_PROVIDER = TracerProvider()
_PROVIDER.add_span_processor(SimpleSpanProcessor(_EXPORTER))
trace.set_tracer_provider(_PROVIDER)


@pytest.fixture
def spans() -> Iterator[InMemorySpanExporter]:
    _EXPORTER.clear()
    yield _EXPORTER
    _EXPORTER.clear()
