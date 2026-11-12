from __future__ import annotations

import threading


class Leaderboard:
    def __init__(self) -> None:
        self.totals: dict[str, int] = {}
        self.lock = threading.Lock()

    def _ordered(self) -> list[str]:
        return sorted(self.totals, key=lambda p: (-self.totals[p], p))

    def add(self, player: str, points: int) -> int:
        if points <= 0:
            raise ValueError("points must be positive")
        with self.lock:
            self.totals[player] = self.totals.get(player, 0) + points
            return self.totals[player]

    def top(self, k: int) -> list[str]:
        if k < 0:
            raise ValueError("negative k")
        with self.lock:
            return self._ordered()[:k]

    def rank(self, player: str) -> int | None:
        with self.lock:
            if player not in self.totals:
                return None
            return self._ordered().index(player) + 1

    def remove(self, player: str) -> bool:
        with self.lock:
            return self.totals.pop(player, None) is not None
