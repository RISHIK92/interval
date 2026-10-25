"""OpenTelemetry tracing for the worker (OPS-2): one root span per run.

A run is one CLI command now; W2-S02's queue consumer wraps each message the same way,
with the message's own id. Spans print only when OTEL_TRACES_EXPORTER=console (opt-in,
owner choice); the beta's ADOT sidecar adds OTLP export.
"""

import os
import sys
from collections.abc import Generator
from contextlib import contextmanager
from uuid import uuid4

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.trace import Status, StatusCode

_tracer = trace.get_tracer("interval-jobs")


def setup() -> None:
    """Installs the tracer provider once. A provider already in place (tests) stays."""
    if isinstance(trace.get_tracer_provider(), TracerProvider):
        return
    provider = TracerProvider(
        resource=Resource.create({"service.name": "interval-jobs"})
    )
    if os.environ.get("OTEL_TRACES_EXPORTER") == "console":
        # stderr: stdout carries log lines and command results (codes, JSON).
        exporter = ConsoleSpanExporter(out=sys.stderr)
        provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)


@contextmanager
def run_span(name: str, message_id: str | None = None) -> Generator[trace.Span]:
    """A root span for one unit of work, tagged with its message id (new if none)."""
    with _tracer.start_as_current_span(
        name,
        context=trace.set_span_in_context(trace.INVALID_SPAN),
        attributes={"message_id": message_id or uuid4().hex},
    ) as span:
        try:
            yield span
        except SystemExit as stop:
            # The CLI fails with sys.exit(message), which OTel doesn't record as an
            # error (it catches Exception only), so the span would look successful.
            if stop.code not in (0, None):
                span.set_status(Status(StatusCode.ERROR, str(stop.code)))
            raise
