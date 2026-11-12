from __future__ import annotations

import heapq
import re
import threading

PREFIX = {"small": "S", "large": "L"}


class ParkingLot:
    def __init__(self, small: int, large: int) -> None:
        if small < 0 or large < 0:
            raise ValueError("negative spot count")
        # Free spot numbers per size, as heaps (a sorted range already is one): the
        # lowest is always first.
        self.spots = {
            "small": list(range(1, small + 1)),
            "large": list(range(1, large + 1)),
        }
        self.cars: dict[str, tuple[str, int]] = {}
        # The extension round: spots out of use, and how many of each size exist.
        self.blocked: set[tuple[str, int]] = set()
        self.counts = {"small": small, "large": large}
        self.lock = threading.Lock()

    def park(self, plate: str, size: str) -> str | None:
        if size not in PREFIX:
            raise ValueError("unknown size")
        with self.lock:
            if plate in self.cars:
                raise ValueError("already parked")
            for kind in ("small", "large") if size == "small" else ("large",):
                if self.spots[kind]:
                    number = heapq.heappop(self.spots[kind])
                    self.cars[plate] = (kind, number)
                    return PREFIX[kind] + str(number)
            return None

    def leave(self, plate: str) -> str | None:
        with self.lock:
            spot = self.cars.pop(plate, None)
            if spot is None:
                return None
            heapq.heappush(self.spots[spot[0]], spot[1])
            return PREFIX[spot[0]] + str(spot[1])

    def where(self, plate: str) -> str | None:
        with self.lock:
            spot = self.cars.get(plate)
            return None if spot is None else PREFIX[spot[0]] + str(spot[1])

    def _spot(self, spot: str) -> tuple[str, int]:
        match = re.fullmatch(r"([SL])([1-9][0-9]*)", spot)
        if match is None:
            raise ValueError("unknown spot")
        kind = "small" if match.group(1) == "S" else "large"
        number = int(match.group(2))
        if number > self.counts[kind]:
            raise ValueError("unknown spot")
        return kind, number

    def block(self, spot: str) -> bool:
        kind, number = self._spot(spot)
        with self.lock:
            if number not in self.spots[kind]:
                return False
            self.spots[kind].remove(number)
            heapq.heapify(self.spots[kind])
            self.blocked.add((kind, number))
            return True

    def unblock(self, spot: str) -> bool:
        kind, number = self._spot(spot)
        with self.lock:
            if (kind, number) not in self.blocked:
                return False
            self.blocked.remove((kind, number))
            heapq.heappush(self.spots[kind], number)
            return True

    def free(self, size: str) -> int:
        if size not in PREFIX:
            raise ValueError("unknown size")
        with self.lock:
            return len(self.spots[size])
