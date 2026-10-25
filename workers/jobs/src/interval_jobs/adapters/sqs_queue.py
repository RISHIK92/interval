"""SQS (ADR-0014): the queue in the full-AWS mode.

One queue per message name: <prefix><name>, each with a DLQ whose maxReceiveCount
matches ATTEMPTS (infra/src/aws-stack.ts). A failed delivery is not deleted, so SQS
redelivers it after the visibility timeout and finally moves it to the DLQ.
"""

import json
import threading
from collections.abc import Mapping
from typing import Protocol, TypedDict

from interval_db.messages import MessageName
from interval_jobs import log
from interval_jobs.ports import Delivery, QueueHandler
from interval_jobs.queue import parse, prepare

# Long polling: fewer empty receives, and messages arrive as soon as they're sent.
WAIT_SECONDS = 20


class _Attribute(TypedDict):
    StringValue: str


class Received(TypedDict):
    Body: str
    ReceiptHandle: str
    Attributes: dict[str, str]
    MessageAttributes: dict[str, _Attribute]


class Batch(TypedDict, total=False):
    Messages: list[Received]


class SqsClient(Protocol):
    """The boto3 SQS calls this adapter makes (boto3 ships no type stubs)."""

    def send_message(
        self,
        *,
        QueueUrl: str,
        MessageBody: str,
        DelaySeconds: int,
        MessageAttributes: dict[str, dict[str, str]],
    ) -> object: ...

    def receive_message(
        self,
        *,
        QueueUrl: str,
        MaxNumberOfMessages: int,
        WaitTimeSeconds: int,
        AttributeNames: list[str],
        MessageAttributeNames: list[str],
    ) -> Batch: ...

    def delete_message(self, *, QueueUrl: str, ReceiptHandle: str) -> object: ...


class SqsQueue:
    def __init__(self, client: SqsClient, url_prefix: str) -> None:
        self._client = client
        self._prefix = url_prefix

    def enqueue(
        self,
        name: MessageName,
        message: Mapping[str, object],
        idempotency_key: str,
        delay_seconds: int = 0,
    ) -> None:
        payload = prepare(name, message, idempotency_key, delay_seconds)
        self._client.send_message(
            QueueUrl=self._prefix + name,
            MessageBody=json.dumps(payload),
            DelaySeconds=delay_seconds,
            # Standard queues don't dedupe; consumers check this key (LOAD-5).
            MessageAttributes={
                "idempotency_key": {
                    "DataType": "String",
                    "StringValue": idempotency_key,
                }
            },
        )


class SqsConsumer:
    def __init__(self, client: SqsClient, url_prefix: str) -> None:
        self._client = client
        self._prefix = url_prefix

    def consume(
        self, name: MessageName, handler: QueueHandler, stop: threading.Event
    ) -> None:
        url = self._prefix + name
        while not stop.is_set():
            # One at a time: a message's visibility timeout starts at receive, so a
            # batch would expire while earlier messages run and be redelivered.
            batch = self._client.receive_message(
                QueueUrl=url,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=WAIT_SECONDS,
                AttributeNames=["ApproximateReceiveCount"],
                MessageAttributeNames=["idempotency_key"],
            )
            for received in batch.get("Messages", []):
                attempt = int(received["Attributes"]["ApproximateReceiveCount"])
                key = received["MessageAttributes"]["idempotency_key"]["StringValue"]
                try:
                    handler(
                        parse(name, json.loads(received["Body"])),
                        Delivery(attempt, key),
                    )
                except Exception as error:  # left on the queue: retry, then the DLQ
                    log.error(
                        "queue: delivery failed",
                        queue=name,
                        attempt=attempt,
                        error=error,
                    )
                    continue
                self._client.delete_message(
                    QueueUrl=url, ReceiptHandle=received["ReceiptHandle"]
                )
