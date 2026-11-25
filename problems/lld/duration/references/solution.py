from __future__ import annotations

import math
import re

PATTERN = re.compile(r"(?:([0-9]{1,9})h)?(?:([0-9]{1,9})m)?(?:([0-9]{1,9})s)?")


def _seconds(text: str) -> int:
    match = PATTERN.fullmatch(text)
    if text == "" or match is None:
        raise ValueError("a duration is like 1h30m15s")
    hours, minutes, seconds = (int(g or "0") for g in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def _canonical(total: int) -> str:
    if total == 0:
        return "0s"
    out = ""
    for amount, unit in ((total // 3600, "h"), (total // 60 % 60, "m"), (total % 60, "s")):
        if amount > 0:
            out += f"{amount}{unit}"
    return out


class Duration:
    def __init__(self, text: str) -> None:
        self._total = _seconds(text)

    def totalSeconds(self) -> int:
        return self._total

    def canonical(self) -> str:
        return _canonical(self._total)

    def plus(self, other: str) -> str:
        return _canonical(self._total + _seconds(other))

    def isLonger(self, other: str) -> bool:
        return self._total > _seconds(other)

    # The extension round.
    def scaled(self, factor: float) -> str:
        if not 0 <= factor <= 1000:
            raise ValueError("factor must be within 0-1000")
        return _canonical(math.floor(self._total * factor))
