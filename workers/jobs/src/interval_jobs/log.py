"""One JSON object per line on stdout (OPS-2), matching the web app's logger."""

import json
import sys
from datetime import UTC, datetime

from opentelemetry import trace


def _default(value: object) -> object:
    if isinstance(value, BaseException):
        return {"name": type(value).__name__, "message": str(value)}
    return repr(value)


def _trace_fields() -> dict[str, object]:
    # OPS-2: lines written inside a span carry its ids, so logs and traces join up.
    context = trace.get_current_span().get_span_context()
    if not context.is_valid:
        return {}
    return {
        "trace_id": format(context.trace_id, "032x"),
        "span_id": format(context.span_id, "016x"),
    }


def _write(level: str, msg: str, fields: dict[str, object]) -> None:
    time = datetime.now(UTC).isoformat()
    try:
        line = json.dumps(
            {**fields, **_trace_fields(), "time": time, "level": level, "msg": msg},
            default=_default,
        )
    except ValueError as error:  # circular reference: never let logging raise
        line = json.dumps(
            {"time": time, "level": level, "msg": msg, "logError": str(error)}
        )
    sys.stdout.write(line + "\n")


def info(msg: str, **fields: object) -> None:
    _write("info", msg, fields)


def warn(msg: str, **fields: object) -> None:
    _write("warn", msg, fields)


def error(msg: str, **fields: object) -> None:
    _write("error", msg, fields)
