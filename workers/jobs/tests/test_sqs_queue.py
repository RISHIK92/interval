"""The SQS adapter (ADR-0014, AWS mode), with a stubbed client: no AWS in tests."""

import json
import threading
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from interval_db.messages import DiscoverSource
from interval_jobs.adapters.sqs_queue import Batch, Received, SqsConsumer, SqsQueue
from interval_jobs.ports import Delivery

PREFIX = "https://sqs.ap-south-1.amazonaws.com/123456789012/interval-prod-aws-"


class FakeSqs:
    """Records sends and deletes; serves one batch of received messages, then stops."""

    def __init__(
        self, bodies: list[str] | None = None, stop: threading.Event | None = None
    ) -> None:
        self.sent: list[dict[str, Any]] = []
        self.deleted: list[str] = []
        self._batch: list[Received] = [
            {
                "Body": body,
                "ReceiptHandle": f"r{i}",
                "Attributes": {"ApproximateReceiveCount": "2"},
                "MessageAttributes": {"idempotency_key": {"StringValue": f"key{i}"}},
            }
            for i, body in enumerate(bodies or [])
        ]
        self._stop = stop

    def send_message(
        self,
        *,
        QueueUrl: str,
        MessageBody: str,
        DelaySeconds: int,
        MessageAttributes: dict[str, dict[str, str]],
    ) -> object:
        self.sent.append(
            {
                "QueueUrl": QueueUrl,
                "MessageBody": MessageBody,
                "DelaySeconds": DelaySeconds,
                "MessageAttributes": MessageAttributes,
            }
        )
        return {"MessageId": "m1"}

    def receive_message(
        self,
        *,
        QueueUrl: str,
        MaxNumberOfMessages: int,
        WaitTimeSeconds: int,
        AttributeNames: list[str],
        MessageAttributeNames: list[str],
    ) -> Batch:
        self.received_from = QueueUrl
        self.batch_size = MaxNumberOfMessages
        batch, self._batch = self._batch, []
        if not batch and self._stop is not None:
            self._stop.set()
        return {"Messages": batch}

    def delete_message(self, *, QueueUrl: str, ReceiptHandle: str) -> object:
        self.deleted.append(ReceiptHandle)
        return {}


def test_enqueue_sends_validated_json_to_the_message_queue() -> None:
    client = FakeSqs()
    SqsQueue(client, PREFIX).enqueue(
        "discover_source", {"source_id": 4}, idempotency_key="k1", delay_seconds=30
    )
    [sent] = client.sent
    assert sent["QueueUrl"] == PREFIX + "discover_source"
    assert json.loads(sent["MessageBody"]) == {"source_id": 4}
    assert sent["DelaySeconds"] == 30
    assert sent["MessageAttributes"]["idempotency_key"] == {
        "DataType": "String",
        "StringValue": "k1",
    }


def test_enqueue_refuses_invalid_messages_and_long_delays() -> None:
    client = FakeSqs()
    with pytest.raises(ValidationError):
        SqsQueue(client, PREFIX).enqueue("discover_source", {"source_id": 0}, "k1")
    with pytest.raises(ValueError, match="900"):
        SqsQueue(client, PREFIX).enqueue("discover_source", {"source_id": 1}, "k1", 901)
    assert client.sent == []


def test_consume_deletes_on_success_and_leaves_failures_for_redelivery(
    capsys: pytest.CaptureFixture[str],
) -> None:
    stop = threading.Event()
    client = FakeSqs([json.dumps({"source_id": 1}), json.dumps({"source_id": 2})], stop)
    seen: list[tuple[int, int, str]] = []

    def handler(message: BaseModel, delivery: Delivery) -> None:
        assert isinstance(message, DiscoverSource)
        seen.append((message.source_id, delivery.attempt, delivery.idempotency_key))
        if message.source_id == 2:
            raise RuntimeError("stage failed")

    SqsConsumer(client, PREFIX).consume("discover_source", handler, stop)
    # The receive count is SQS's attempt number; a failure isn't deleted, so SQS
    # redelivers it and, after maxReceiveCount, moves it to the DLQ.
    assert seen == [(1, 2, "key0"), (2, 2, "key1")]
    # One message per receive: its visibility timeout starts at receive.
    assert client.batch_size == 1
    assert client.deleted == ["r0"]
    assert client.received_from == PREFIX + "discover_source"
    assert "queue: delivery failed" in capsys.readouterr().out


def test_a_message_that_no_longer_matches_its_schema_is_left_for_the_dlq(
    capsys: pytest.CaptureFixture[str],
) -> None:
    stop = threading.Event()
    client = FakeSqs([json.dumps({"source_id": "x"})], stop)

    def handler(message: BaseModel, delivery: Delivery) -> None:
        raise AssertionError("never called for an invalid message")

    SqsConsumer(client, PREFIX).consume("discover_source", handler, stop)
    assert client.deleted == []
    assert "queue: delivery failed" in capsys.readouterr().out
