from __future__ import annotations


def _named(name: str) -> None:
    if name == "":
        raise ValueError("names are not empty")


class OrgChart:
    """Each person knows their manager, and each manager knows their direct reports; the
    two sides change together. The root is the one person with no manager."""

    def __init__(self, ceo: str) -> None:
        _named(ceo)
        self._root = ceo
        self._manager: dict[str, str | None] = {ceo: None}
        self._reports: dict[str, set[str]] = {ceo: set()}

    def _link(self, name: str, manager: str | None) -> None:
        self._manager[name] = manager
        if manager is not None:
            self._reports[manager].add(name)

    def _unlink(self, name: str) -> None:
        manager = self._manager[name]
        if manager is not None:
            self._reports[manager].discard(name)

    def hire(self, name: str, manager: str) -> bool:
        _named(name)
        _named(manager)
        if name in self._manager or manager not in self._manager:
            return False
        self._reports[name] = set()
        self._link(name, manager)
        return True

    def reassign(self, name: str, manager: str) -> bool:
        _named(name)
        _named(manager)
        if name not in self._manager or manager not in self._manager or name == self._root:
            return False
        if name in self.chain(manager):
            return False
        self._unlink(name)
        self._link(name, manager)
        return True

    def leave(self, name: str) -> bool:
        _named(name)
        if name not in self._manager or name == self._root:
            return False
        up = self._manager[name]
        self._unlink(name)
        for report in self._reports.pop(name):
            self._link(report, up)
        del self._manager[name]
        return True

    def chain(self, name: str) -> list[str]:
        _named(name)
        if name not in self._manager:
            raise ValueError("unknown person")
        out: list[str] = []
        at: str | None = name
        while at is not None:
            out.append(at)
            at = self._manager[at]
        return out

    def span(self, manager: str) -> int:
        _named(manager)
        if manager not in self._reports:
            raise ValueError("unknown person")
        return len(self._reports[manager])

    # The extension round: a person swaps places with their manager.
    def promote(self, name: str) -> bool:
        _named(name)
        if name not in self._manager or name == self._root:
            return False
        boss = self._manager[name]
        assert boss is not None  # only the root has no manager
        above = self._manager[boss]
        theirs = self._reports[boss] - {name}
        mine = self._reports[name]
        self._unlink(boss)
        self._link(name, above)
        self._reports[name] = set()
        self._reports[boss] = set()
        self._link(boss, name)
        for report in theirs:
            self._link(report, name)
        for report in mine:
            self._link(report, boss)
        if boss == self._root:
            self._root = name
        return True
