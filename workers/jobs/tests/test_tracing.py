"""OPS-2: one trace per worker run, and log lines that join to it."""

import json
import os
import subprocess
import sys
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from interval_jobs import __main__ as cli
from interval_jobs import log
from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.tracing import run_span


def test_a_run_is_one_root_span_with_a_message_id(
    spans: InMemorySpanExporter,
) -> None:
    with (
        run_span("rebuild-feed"),
        trace.get_tracer("test").start_as_current_span("inner"),
    ):
        pass
    finished = {span.name: span for span in spans.get_finished_spans()}
    root = finished["rebuild-feed"]
    assert root.parent is None
    assert root.attributes is not None
    message_id = root.attributes.get("message_id")
    assert isinstance(message_id, str) and len(message_id) == 32
    inner = finished["inner"]
    assert inner.parent is not None
    assert root.context is not None
    assert inner.parent.span_id == root.context.span_id


def test_log_lines_carry_the_current_trace(
    spans: InMemorySpanExporter, capsys: pytest.CaptureFixture[str]
) -> None:
    with run_span("purge-guests") as span:
        log.info("inside")
    log.info("outside")
    inside, outside = (
        json.loads(line) for line in capsys.readouterr().out.splitlines()
    )
    context = span.get_span_context()
    assert inside["trace_id"] == format(context.trace_id, "032x")
    assert inside["span_id"] == format(context.span_id, "016x")
    assert "trace_id" not in outside


@dataclass
class FakeServices:
    store: InMemoryStore


def test_a_failed_cli_run_is_one_root_span_marked_as_an_error(
    spans: InMemorySpanExporter, monkeypatch: pytest.MonkeyPatch
) -> None:
    @contextmanager
    def services() -> Generator[FakeServices]:
        yield FakeServices(InMemoryStore())

    monkeypatch.setattr(cli, "services", services)
    # Every CLI failure path is sys.exit(message); the span must still say it failed.
    with pytest.raises(SystemExit):
        cli.main(
            ["grant-capability", "--email", "x@y.test", "--capability", "admin.review"]
        )
    [span] = spans.get_finished_spans()
    assert span.name == "grant-capability"
    assert span.parent is None
    assert span.status.status_code is StatusCode.ERROR
    assert "no account" in (span.status.description or "")


def test_console_tracing_prints_the_root_span_to_stderr(tmp_path: Path) -> None:
    # The real setup() in a fresh process (the suite's own provider is in-memory).
    env = {
        **os.environ,
        "OTEL_TRACES_EXPORTER": "console",
        "EVENTS_TRANSPORT": "file",
        "EVENTS_DIR": str(tmp_path),
    }
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "interval_jobs",
            "grant-capability",
            "--email",
            "nobody-tracing@example.test",
            "--capability",
            "admin.review",
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 1
    # Spans never mix with the command's own output on stdout.
    assert '"name": "grant-capability"' not in result.stdout
    assert '"name": "grant-capability"' in result.stderr
    assert '"parent_id": null' in result.stderr
