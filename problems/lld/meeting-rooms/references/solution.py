from __future__ import annotations

import threading


class MeetingRooms:
    def __init__(self, count: int) -> None:
        if count < 1:
            raise ValueError("count must be at least 1")
        # Each room's meetings, start -> end.
        self.rooms: list[dict[int, int]] = [{} for _ in range(count)]
        self.lock = threading.Lock()

    def book(self, start: int, end: int) -> int | None:
        if end <= start:
            raise ValueError("end must be after start")
        with self.lock:
            for number, meetings in enumerate(self.rooms, start=1):
                if all(end <= s or e <= start for s, e in meetings.items()):
                    meetings[start] = end
                    return number
            return None

    def cancel(self, room: int, start: int) -> bool:
        with self.lock:
            if not 1 <= room <= len(self.rooms):
                return False
            return self.rooms[room - 1].pop(start, None) is not None

    # The extension round.
    def extend(self, room: int, start: int, end: int) -> bool:
        if end <= start:
            raise ValueError("end must be after start")
        with self.lock:
            if not 1 <= room <= len(self.rooms):
                return False
            meetings = self.rooms[room - 1]
            if start not in meetings:
                return False
            # Against the room's other meetings only: shrinking always fits.
            if any(start < e and s < end for s, e in meetings.items() if s != start):
                return False
            meetings[start] = end
            return True

    def free(self, at: int) -> int:
        with self.lock:
            return sum(
                1
                for meetings in self.rooms
                if not any(s <= at < e for s, e in meetings.items())
            )
