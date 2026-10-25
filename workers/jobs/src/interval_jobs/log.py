"""One JSON object per line on stdout (OPS-2), matching the web app's logger."""

import json
import sys
from datetime import UTC, datetime


def _default(value: object) -> object:
    if isinstance(value, BaseException):
        return {"name": type(value).__name__, "message": str(value)}
    return repr(value)


def _write(level: str, msg: str, fields: dict[str, object]) -> None:
    time = datetime.now(UTC).isoformat()
    try:
        line = json.dumps(
            {**fields, "time": time, "level": level, "msg": msg}, default=_default
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
