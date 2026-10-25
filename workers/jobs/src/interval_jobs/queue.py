"""Rules every queue adapter shares (ADR-0014): the intersection of BullMQ and SQS."""

import re
from collections.abc import Mapping

from pydantic import BaseModel

from interval_db.messages import MESSAGES, MessageName

# 3 deliveries, then the failed store (BullMQ's failed set, or the SQS DLQ's
# maxReceiveCount in infra/src/aws-stack.ts).
ATTEMPTS = 3
# SQS's DelaySeconds limit; BullMQ allows more, but both engines must behave alike.
MAX_DELAY_SECONDS = 900


# BullMQ uses the key as the job id, which can't be empty, all digits or contain ":";
# SQS takes anything. Keys must work on both.
KEY = re.compile(r"^(?!\d+$)[A-Za-z0-9_.@/-]{1,200}$")


def prepare(
    name: MessageName,
    message: Mapping[str, object],
    idempotency_key: str,
    delay_seconds: int,
) -> dict[str, object]:
    """The validated message as JSON-ready data, or an error before anything is sent."""
    if not 0 <= delay_seconds <= MAX_DELAY_SECONDS:
        raise ValueError(f"delay_seconds must be 0 to {MAX_DELAY_SECONDS}")
    if not KEY.match(idempotency_key):
        raise ValueError(
            "idempotency_key must be 1-200 of A-Z a-z 0-9 _ . @ / -, not only digits"
        )
    model = MESSAGES[name].model_validate(dict(message))
    # Optional fields are left out, never sent as null (zod rejects null).
    return model.model_dump(mode="json", exclude_none=True)


def parse(name: MessageName, payload: object) -> BaseModel:
    return MESSAGES[name].model_validate(payload)
