"""DB-5: events into Firehose, which writes them to S3 for Athena.

Each record ends in a newline, so the S3 objects are JSON lines. PutRecordBatch takes at
most 500 records per call.
"""

from typing import Any, Protocol

from interval_jobs.events.generated import Envelope

MAX_RECORDS = 500


class FirehoseClient(Protocol):
    """The one boto3 Firehose call this adapter makes (boto3 ships no type stubs)."""

    def put_record_batch(
        self, *, DeliveryStreamName: str, Records: list[dict[str, bytes]]
    ) -> dict[str, Any]: ...


class FirehoseEventSink:
    def __init__(self, client: FirehoseClient, stream: str) -> None:
        self._client = client
        self._stream = stream

    def write(self, batch: list[Envelope]) -> list[Envelope]:
        failed: list[Envelope] = []
        for start in range(0, len(batch), MAX_RECORDS):
            chunk = batch[start : start + MAX_RECORDS]
            result = self._client.put_record_batch(
                DeliveryStreamName=self._stream,
                Records=[
                    {"Data": (e.model_dump_json() + "\n").encode()} for e in chunk
                ],
            )
            if not result.get("FailedPutCount"):
                continue
            responses: list[dict[str, Any]] = result.get("RequestResponses", [])
            # Without one response per record we can't tell which failed: retry all.
            if len(responses) != len(chunk):
                failed.extend(chunk)
                continue
            # Responses are in request order; a record with an ErrorCode was not stored.
            failed.extend(
                event
                for event, response in zip(chunk, responses, strict=True)
                if "ErrorCode" in response
            )
        return failed
