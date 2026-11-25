from __future__ import annotations


def _named(name: str) -> None:
    if name == "":
        raise ValueError("check names are not empty")


class DeployGate:
    """Callers tell the gate what happened and ask it one question, "may I deploy?".
    Which checks are required, what they last reported and which are waived stay inside."""

    def __init__(self) -> None:
        self._required: set[str] = set()
        self._passed: dict[str, bool] = {}  # each check's latest report
        self._waived: dict[str, str] = {}  # check -> reason

    def require(self, check: str) -> None:
        _named(check)
        self._required.add(check)

    def report(self, check: str, passed: bool) -> None:
        _named(check)
        self._passed[check] = passed

    def _blocks(self, check: str) -> bool:
        return check not in self._waived and not self._passed.get(check, False)

    def mayDeploy(self) -> bool:
        return not any(self._blocks(c) for c in self._required)

    def blockers(self) -> list[str]:
        return sorted(c for c in self._required if self._blocks(c))

    # The extension round: a waived check never blocks.
    def waive(self, check: str, reason: str) -> None:
        _named(check)
        if reason == "":
            raise ValueError("a waiver has a reason")
        if check not in self._required:
            raise ValueError("only a required check is waived")
        self._waived[check] = reason

    def waivers(self) -> list[str]:
        return [f"{c}: {self._waived[c]}" for c in sorted(self._waived)]
