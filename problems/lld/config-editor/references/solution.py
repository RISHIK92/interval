from __future__ import annotations

from typing import Protocol


class Command(Protocol):
    def do(self, config: dict[str, str]) -> None: ...

    def undo(self, config: dict[str, str]) -> None: ...


class Edit:
    """A command: one edit to one key. Doing it remembers the key's value before, so
    undoing it is the same for every kind of edit."""

    def __init__(self, key: str, val: str) -> None:
        self.key = key
        self.val = val
        self._before: str | None = None

    def refused(self, config: dict[str, str]) -> bool:
        raise NotImplementedError

    def change(self, config: dict[str, str]) -> None:
        raise NotImplementedError

    def do(self, config: dict[str, str]) -> None:
        self._before = config.get(self.key)
        self.change(config)

    def undo(self, config: dict[str, str]) -> None:
        if self._before is None:
            del config[self.key]
        else:
            config[self.key] = self._before


class Put(Edit):
    def refused(self, config: dict[str, str]) -> bool:
        return config.get(self.key) == self.val

    def change(self, config: dict[str, str]) -> None:
        config[self.key] = self.val


class Remove(Edit):
    def refused(self, config: dict[str, str]) -> bool:
        return self.key not in config

    def change(self, config: dict[str, str]) -> None:
        del config[self.key]


class Append(Edit):
    def refused(self, config: dict[str, str]) -> bool:
        return self.key not in config or self.val == ""

    def change(self, config: dict[str, str]) -> None:
        config[self.key] += self.val


class Batch:
    """Several edits done and undone as one command: undone in reverse order."""

    def __init__(self, edits: list[Edit]) -> None:
        self._edits = edits

    def do(self, config: dict[str, str]) -> None:
        for edit in self._edits:
            edit.do(config)

    def undo(self, config: dict[str, str]) -> None:
        for edit in reversed(self._edits):
            edit.undo(config)


OPS: dict[str, type[Edit]] = {"put": Put, "remove": Remove, "append": Append}


def _edit(op: str, key: str, val: str) -> Edit:
    kind = OPS.get(op)
    if kind is None or key == "":
        raise ValueError("unknown op or empty key")
    return kind(key, val)


class ConfigEditor:
    """Every change is a command kept on a history, so undo and redo never need to know
    which kind of edit they're reversing."""

    def __init__(self) -> None:
        self._config: dict[str, str] = {}
        self._done: list[Command] = []
        self._undone: list[Command] = []

    def apply(self, op: str, key: str, val: str) -> bool:
        edit = _edit(op, key, val)
        if edit.refused(self._config):
            return False
        edit.do(self._config)
        self._record(edit)
        return True

    def undo(self) -> bool:
        if not self._done:
            return False
        command = self._done.pop()
        command.undo(self._config)
        self._undone.append(command)
        return True

    def redo(self) -> bool:
        if not self._undone:
            return False
        command = self._undone.pop()
        command.do(self._config)
        self._done.append(command)
        return True

    def view(self) -> dict[str, str]:
        return dict(self._config)

    # The extension round: several edits as one command.
    def batch(self, ops: list[str]) -> bool:
        edits = [self._parse(entry) for entry in ops]
        applied: list[Edit] = []
        for edit in edits:
            if not edit.refused(self._config):
                edit.do(self._config)
                applied.append(edit)
        if not applied:
            return False
        self._record(Batch(applied))
        return True

    @staticmethod
    def _parse(entry: str) -> Edit:
        fields = entry.split(" ", 2)
        if len(fields) != 3:
            raise ValueError("not <op> <key> <val>")
        return _edit(fields[0], fields[1], fields[2])

    def _record(self, command: Command) -> None:
        self._done.append(command)
        self._undone.clear()
