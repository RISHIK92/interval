"""Development events (owner, 2026-10-25): JSON lines, one file per UTC day."""

from collections import defaultdict
from datetime import UTC
from pathlib import Path

from interval_jobs.events.generated import Envelope


class FileEventSink:
    def __init__(self, directory: Path) -> None:
        self._directory = directory

    def write(self, batch: list[Envelope]) -> list[Envelope]:
        self._directory.mkdir(parents=True, exist_ok=True)
        by_day: defaultdict[str, list[str]] = defaultdict(list)
        for event in batch:
            day = event.occurred_at.astimezone(UTC).date().isoformat()
            by_day[day].append(event.model_dump_json() + "\n")
        for day, lines in by_day.items():
            with (self._directory / f"{day}.jsonl").open("a", encoding="utf-8") as f:
                f.writelines(lines)
        return []
