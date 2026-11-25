from __future__ import annotations

DIGITS = "0123456789"


def _parse(text: str) -> tuple[int, int, int]:
    parts = text.split(".")
    if len(parts) != 3:
        raise ValueError("a version is major.minor.patch")
    for part in parts:
        if part == "" or len(part) > 9 or any(c not in DIGITS for c in part):
            raise ValueError("each part is 1 to 9 digits")
        if part[0] == "0" and len(part) > 1:
            raise ValueError("no leading zeros")
    return int(parts[0]), int(parts[1]), int(parts[2])


def _compatible(a: tuple[int, int, int], b: tuple[int, int, int]) -> bool:
    if a[0] != b[0]:
        return False
    return a[0] > 0 or a[1] == b[1]


class SemVer:
    def __init__(self, text: str) -> None:
        self._version = _parse(text)

    def bump(self, part: str) -> str:
        major, minor, patch = self._version
        if part == "major":
            return f"{major + 1}.0.0"
        if part == "minor":
            return f"{major}.{minor + 1}.0"
        if part == "patch":
            return f"{major}.{minor}.{patch + 1}"
        raise ValueError("part is major, minor or patch")

    def compareTo(self, other: str) -> int:
        theirs = _parse(other)
        return (self._version > theirs) - (self._version < theirs)

    def isCompatible(self, other: str) -> bool:
        return _compatible(self._version, _parse(other))

    def text(self) -> str:
        return "{}.{}.{}".format(*self._version)

    # The extension round.
    def satisfies(self, constraint: str) -> bool:
        if constraint[:1] not in ("^", "~"):
            raise ValueError("a constraint is ^ or ~ and a version")
        base = _parse(constraint[1:])
        if self._version < base:
            return False
        if constraint[0] == "^":
            return _compatible(self._version, base)
        return self._version[:2] == base[:2]
