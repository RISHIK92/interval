from __future__ import annotations


class DiskQuota:
    def __init__(self, limitBytes: int) -> None:
        if limitBytes < 0:
            raise ValueError("the limit can't be negative")
        self._limit = limitBytes
        self._total = 0
        # Only owners holding more than 0 bytes.
        self._held: dict[str, int] = {}
        self._soft: int | None = None

    def reserve(self, owner: str, bytes: int) -> bool:
        if bytes < 1:
            raise ValueError("reserve at least one byte")
        # Compared by subtraction: both sides stay within the limit's range.
        if bytes > self._limit - self._total:
            return False
        self._held[owner] = self.used(owner) + bytes
        self._total += bytes
        return True

    def release(self, owner: str, bytes: int) -> None:
        if bytes < 1:
            raise ValueError("release at least one byte")
        held = self.used(owner)
        if bytes > held:
            raise ValueError("more than the owner holds")
        if held == bytes:
            del self._held[owner]
        else:
            self._held[owner] = held - bytes
        self._total -= bytes

    def used(self, owner: str) -> int:
        return self._held.get(owner, 0)

    def free(self) -> int:
        return self._limit - self._total

    # The extension round.
    def softLimit(self, bytes: int) -> None:
        if bytes < 0:
            raise ValueError("the soft limit can't be negative")
        self._soft = bytes

    def warnings(self) -> list[str]:
        soft = self._soft
        if soft is None:
            return []
        return sorted(owner for owner, held in self._held.items() if held > soft)
