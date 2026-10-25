"""Event emission in the worker (DB-5, Q-P1-20): the same rules as the web app."""

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, get_args

import pytest
from pydantic import TypeAdapter, ValidationError

from interval_db.generated import BetaGroup as DbBetaGroup
from interval_jobs.adapters.file_sink import FileEventSink
from interval_jobs.adapters.firehose_sink import FirehoseEventSink
from interval_jobs.events.emitter import Emitter, EventContext
from interval_jobs.events.generated import BetaGroup, Envelope

ENVELOPE = TypeAdapter[Envelope](Envelope)
CONTEXT = EventContext(
    user_id="u1", is_guest=False, beta_group="developer", session_id=None
)


class RecordingSink:
    def __init__(self, fail: list[int] | None = None) -> None:
        self.batches: list[list[Envelope]] = []
        self._fail = fail or []  # how many records to fail on each call

    def write(self, batch: list[Envelope]) -> list[Envelope]:
        self.batches.append(batch)
        call = len(self.batches) - 1
        count = self._fail[call] if call < len(self._fail) else 0
        return batch[:count]


class BrokenSink:
    calls = 0

    def write(self, batch: list[Envelope]) -> list[Envelope]:
        self.calls += 1
        raise ConnectionError("firehose down")


def failures(capsys: pytest.CaptureFixture[str]) -> list[dict[str, Any]]:
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    return [line for line in lines if line["msg"] == "events: emit failed"]


def test_events_carry_a_valid_envelope_from_the_jobs_source() -> None:
    sink = RecordingSink()
    emitter = Emitter(sink)
    emitter.emit("feed_viewed", {"card_count": 2}, CONTEXT)
    emitter.flush()
    [event] = sink.batches[0]
    assert ENVELOPE.validate_python(event.model_dump()) == event
    assert event.source == "jobs"
    assert event.name == "feed_viewed"
    assert event.occurred_at.tzinfo is not None


def test_event_ids_are_unique_and_nothing_is_written_before_a_flush() -> None:
    sink = RecordingSink()
    emitter = Emitter(sink, max_batch=10_000)
    for _ in range(1000):
        emitter.emit("signup_completed", {}, CONTEXT)
    assert sink.batches == []
    emitter.flush()
    assert len({e.event_id for e in sink.batches[0]}) == 1000


def test_a_full_batch_is_written_at_once() -> None:
    sink = RecordingSink()
    emitter = Emitter(sink, max_batch=3)
    for _ in range(3):
        emitter.emit("signup_completed", {}, CONTEXT)
    assert [len(b) for b in sink.batches] == [3]


def test_rejected_records_are_retried_once_then_dropped_logged_and_counted(
    capsys: pytest.CaptureFixture[str],
) -> None:
    sink = RecordingSink(fail=[2, 1])
    emitter = Emitter(sink)
    emitter.emit("signup_completed", {}, CONTEXT)
    emitter.emit("feed_viewed", {"card_count": 1}, CONTEXT)
    emitter.flush()
    assert [len(b) for b in sink.batches] == [2, 2]
    [failure] = failures(capsys)
    assert failure["count"] == 1
    assert failure["names"] == ["signup_completed"]


def test_a_sink_that_raises_is_retried_once_and_never_raises(
    capsys: pytest.CaptureFixture[str],
) -> None:
    sink = BrokenSink()
    emitter = Emitter(sink)
    emitter.emit("signup_completed", {}, CONTEXT)
    emitter.flush()
    assert sink.calls == 2
    assert failures(capsys)[0]["count"] == 1


def test_invalid_props_are_dropped_logged_and_counted_never_raised(
    capsys: pytest.CaptureFixture[str],
) -> None:
    sink = RecordingSink()
    emitter = Emitter(sink)
    emitter.emit("feed_viewed", {"card_count": -1}, CONTEXT)
    emitter.flush()
    assert sink.batches == []
    [failure] = failures(capsys)
    assert failure["reason"] == "invalid"


def test_the_event_spec_and_the_database_agree_on_beta_groups() -> None:
    assert set(get_args(BetaGroup.__value__)) == set(get_args(DbBetaGroup.__value__))


def event(day: datetime) -> Envelope:
    return ENVELOPE.validate_python(
        {
            "event_id": "6f1c1f3e-0b7a-4c55-9d43-0d6a1f0b2c11",
            "name": "signup_completed",
            "version": 1,
            "occurred_at": day,
            "user_id": "u1",
            "is_guest": False,
            "beta_group": "student",
            "session_id": None,
            "source": "jobs",
            "props": {},
        }
    )


def test_the_file_sink_appends_json_lines_per_utc_day(tmp_path: Path) -> None:
    sink = FileEventSink(tmp_path / "events")
    late = event(datetime(2026, 10, 25, 23, 59, tzinfo=UTC))
    early = event(datetime(2026, 10, 26, 0, 0, tzinfo=UTC))
    assert sink.write([late, early]) == []
    files = sorted(p.name for p in (tmp_path / "events").iterdir())
    assert files == ["2026-10-25.jsonl", "2026-10-26.jsonl"]
    line = (tmp_path / "events" / "2026-10-25.jsonl").read_text(encoding="utf-8")
    assert json.loads(line)["name"] == "signup_completed"


class FakeFirehose:
    def __init__(self, fail_index: int | None = None) -> None:
        self.calls: list[tuple[str, list[bytes]]] = []
        self._fail_index = fail_index

    def put_record_batch(
        self, *, DeliveryStreamName: str, Records: list[dict[str, bytes]]
    ) -> dict[str, Any]:
        self.calls.append((DeliveryStreamName, [r["Data"] for r in Records]))
        responses = [
            {"ErrorCode": "ServiceUnavailableException"}
            if i == self._fail_index
            else {"RecordId": str(i)}
            for i in range(len(Records))
        ]
        failed = sum(1 for r in responses if "ErrorCode" in r)
        return {"FailedPutCount": failed, "RequestResponses": responses}


def test_the_firehose_sink_sends_newline_json_in_batches_of_500() -> None:
    client = FakeFirehose()
    events = [event(datetime(2026, 10, 25, tzinfo=UTC))] * 501
    assert FirehoseEventSink(client, "interval-events").write(events) == []
    assert [len(records) for _, records in client.calls] == [500, 1]
    stream, records = client.calls[0]
    assert stream == "interval-events"
    assert records[0].endswith(b"\n")
    assert json.loads(records[0])["source"] == "jobs"


def test_the_firehose_sink_returns_the_records_it_rejected() -> None:
    events = [event(datetime(2026, 10, 25, tzinfo=UTC)) for _ in range(3)]
    assert FirehoseEventSink(FakeFirehose(fail_index=1), "s").write(events) == [
        events[1]
    ]


class NoResponsesFirehose:
    def put_record_batch(
        self, *, DeliveryStreamName: str, Records: list[dict[str, bytes]]
    ) -> dict[str, Any]:
        return {"FailedPutCount": 1}


def test_failures_without_per_record_responses_count_the_whole_chunk() -> None:
    events = [event(datetime(2026, 10, 25, tzinfo=UTC)) for _ in range(2)]
    assert FirehoseEventSink(NoResponsesFirehose(), "s").write(events) == events


def test_occurred_at_is_utc_with_milliseconds_like_the_web_app() -> None:
    # Athena reads one timestamp format from both emitters.
    sink = RecordingSink()
    emitter = Emitter(sink)
    emitter.emit("signup_completed", {}, CONTEXT)
    emitter.flush()
    line = json.loads(sink.batches[0][0].model_dump_json())
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", line["occurred_at"])


def test_the_envelope_is_strict_like_the_web_app() -> None:
    raw = event(datetime(2026, 10, 25, tzinfo=UTC)).model_dump()
    with pytest.raises(ValidationError):
        ENVELOPE.validate_python({**raw, "is_guest": "false"})
