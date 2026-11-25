from __future__ import annotations


class FeatureFlag:
    def __init__(self, name: str, rolloutPercent: int) -> None:
        if name == "":
            raise ValueError("a flag needs a name")
        self._name = name
        self._percent = self._checked_percent(rolloutPercent)
        self._killed = False
        self._allowed: set[int] = set()

    @staticmethod
    def _checked_percent(percent: int) -> int:
        if not 0 <= percent <= 100:
            raise ValueError("percent must be within 0-100")
        return percent

    @staticmethod
    def _checked_bucket(bucket: int) -> int:
        if not 0 <= bucket <= 99:
            raise ValueError("bucket must be within 0-99")
        return bucket

    def enabledFor(self, userBucket: int) -> bool:
        bucket = self._checked_bucket(userBucket)
        if self._killed:
            return False
        return bucket in self._allowed or bucket < self._percent

    def setRollout(self, percent: int) -> None:
        self._percent = self._checked_percent(percent)

    def kill(self) -> None:
        self._killed = True

    def revive(self) -> None:
        self._killed = False

    # The extension round.
    def allow(self, userBucket: int) -> None:
        self._allowed.add(self._checked_bucket(userBucket))
