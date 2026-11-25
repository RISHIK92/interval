from __future__ import annotations

import re

KEY = re.compile(r"[A-Z][A-Z0-9_]*")


def _checked_key(key: str) -> str:
    if KEY.fullmatch(key) is None:
        raise ValueError("an env key is upper snake case")
    return key


class JobSpec:
    def __init__(self, name: str) -> None:
        if name == "":
            raise ValueError("a job needs a name")
        self._name = name
        self._steps: list[str] = []
        # key -> (value, secret)
        self._env: dict[str, tuple[str, bool]] = {}

    def addStep(self, command: str) -> int:
        if command == "":
            raise ValueError("a step needs a command")
        self._steps.append(command)
        return len(self._steps)

    def setEnv(self, key: str, value: str) -> None:
        self._env[_checked_key(key)] = (value, False)

    def render(self) -> list[str]:
        lines = [f"job {self._name}"]
        for key in sorted(self._env):
            value, secret = self._env[key]
            lines.append(f"env {key}={'***' if secret else value}")
        lines += [f"step {n}: {command}" for n, command in enumerate(self._steps, 1)]
        return lines

    def stepCount(self) -> int:
        return len(self._steps)

    # The extension round.
    def secret(self, key: str, value: str) -> None:
        self._env[_checked_key(key)] = (value, True)
