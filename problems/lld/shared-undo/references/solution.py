from __future__ import annotations


def _name(text: str) -> None:
    if text == "":
        raise ValueError("an empty name or value")


def _user(user: str) -> None:
    _name(user)
    if ":" in user:
        raise ValueError("a user name has no colon")


class Edit:
    """A command that remembers the key's value before it ran (its memento), so it can
    be undone and redone. `at` counts its key's writes up to the one that last applied
    it: the edit, an undo or a redo."""

    at: int

    def __init__(self, user: str, key: str, before: str | None, after: str) -> None:
        self.user = user
        self.key = key
        self.before = before
        self.after = after


class SharedDoc:
    def __init__(self) -> None:
        self._values: dict[str, str] = {}
        self._writes: dict[str, list[tuple[str, str]]] = {}  # key -> (user, entry)
        self._undo: dict[str, list[Edit]] = {}
        self._redo: dict[str, list[Edit]] = {}

    def edit(self, user: str, key: str, val: str) -> None:
        _user(user)
        _name(key)
        _name(val)
        command = Edit(user, key, self._values.get(key), val)
        self._write(command, "edit", val)
        self._undo.setdefault(user, []).append(command)
        self._redo[user] = []

    def undo(self, user: str) -> bool:
        return self._undo_last(user, False)

    def redo(self, user: str) -> bool:
        _user(user)
        stack = self._redo.get(user, [])
        if not stack or self._conflicts(stack[-1]):
            return False
        command = stack.pop()
        self._write(command, "redo", command.after)
        self._undo[user].append(command)
        return True

    def value(self, key: str) -> str | None:
        _name(key)
        return self._values.get(key)

    def history(self, key: str) -> list[str]:
        _name(key)
        return [entry for _, entry in self._writes.get(key, [])]

    # The extension round: an undo that goes through despite a conflict.
    def undoForce(self, user: str) -> bool:
        return self._undo_last(user, True)

    def _undo_last(self, user: str, force: bool) -> bool:
        _user(user)
        stack = self._undo.get(user, [])
        if not stack:
            return False
        action = "undo"
        if self._conflicts(stack[-1]):
            if not force:
                return False
            action = "force"
        command = stack.pop()
        self._write(command, action, command.before)
        self._redo[user].append(command)
        return True

    def _conflicts(self, command: Edit) -> bool:
        """Someone else wrote the key after the command last took effect."""
        later = self._writes[command.key][command.at :]
        return any(who != command.user for who, _ in later)

    def _write(self, command: Edit, action: str, val: str | None) -> None:
        if val is None:
            del self._values[command.key]
        else:
            self._values[command.key] = val
        writes = self._writes.setdefault(command.key, [])
        writes.append((command.user, f"{action}:{command.user}:{val or ''}"))
        command.at = len(writes)
