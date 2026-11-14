from __future__ import annotations

import threading


class ElevatorSystem:
    def __init__(self, elevators: int, floors: int) -> None:
        if elevators < 1 or floors < 1:
            raise ValueError("need an elevator and a floor")
        self.top = floors
        self.at = [0] * elevators
        self.stops: list[set[int]] = [set() for _ in range(elevators)]
        # The extension round: elevators out of service.
        self.out = [False] * elevators
        self.lock = threading.Lock()

    def _elevator(self, elevator: int) -> None:
        if not 0 <= elevator < len(self.at):
            raise ValueError("unknown elevator")

    def _floor(self, floor: int) -> None:
        if not 0 <= floor <= self.top:
            raise ValueError("unknown floor")

    def _target(self, i: int) -> int:
        return min(self.stops[i], key=lambda s: (abs(s - self.at[i]), s))

    # Callers hold the lock.
    def _dispatch(self, floor: int) -> int:
        live = [i for i in range(len(self.at)) if not self.out[i]]
        for i in live:
            if floor in self.stops[i]:
                return i
        best = min(live, key=lambda i: (abs(self.at[i] - floor) + len(self.stops[i]), i))
        self.stops[best].add(floor)
        return best

    def request(self, floor: int) -> int:
        self._floor(floor)
        with self.lock:
            return self._dispatch(floor)

    def press(self, elevator: int, floor: int) -> bool:
        self._elevator(elevator)
        self._floor(floor)
        with self.lock:
            if self.out[elevator]:
                raise ValueError("out of service")
            if floor in self.stops[elevator]:
                return False
            self.stops[elevator].add(floor)
            return True

    def step(self) -> list[str]:
        with self.lock:
            opened: list[str] = []
            for i in range(len(self.at)):
                if not self.stops[i]:
                    continue
                target = self._target(i)
                if target != self.at[i]:
                    self.at[i] += 1 if target > self.at[i] else -1
                if self.at[i] in self.stops[i]:
                    self.stops[i].discard(self.at[i])
                    opened.append(f"{i}:{self.at[i]}")
            return opened

    def status(self, elevator: int) -> str:
        self._elevator(elevator)
        with self.lock:
            here = self.at[elevator]
            if self.out[elevator]:
                return f"{here} out -"
            if not self.stops[elevator]:
                return f"{here} idle -"
            target = self._target(elevator)
            state = "here" if target == here else "up" if target > here else "down"
            return f"{here} {state} " + ",".join(str(s) for s in sorted(self.stops[elevator]))

    def outOfService(self, elevator: int) -> bool:
        self._elevator(elevator)
        with self.lock:
            if self.out[elevator]:
                return False
            if self.out.count(False) == 1:
                raise ValueError("last elevator in service")
            self.out[elevator] = True
            pending = sorted(self.stops[elevator])
            self.stops[elevator] = set()
            for floor in pending:
                self._dispatch(floor)
            return True
