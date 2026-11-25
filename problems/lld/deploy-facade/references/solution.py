from __future__ import annotations


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty")


class Subsystem:
    """One of the tools a deploy drives (the builder, the registry, the migrator, the
    cluster, the chat bot). Each can run a release and undo it, and can be set to fail
    its next run."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.broken = False

    def run(self, release: str) -> str:
        return f"{self.name} {release}"

    def undo(self, release: str) -> str:
        return f"undo {self.name} {release}"


class DeployFacade:
    """One call in front of five subsystems: it runs them in order, unwinds the ones that
    ran when one fails, and keeps each service's live versions."""

    def __init__(self) -> None:
        self._steps = [Subsystem(name) for name in ("build", "push", "migrate", "rollout", "announce")]
        self._history: dict[str, list[str]] = {}

    def deploy(self, service: str, version: str) -> list[str]:
        return self._run(service, version, True)

    def breakStep(self, step: str) -> None:
        for subsystem in self._steps:
            if subsystem.name == step:
                subsystem.broken = True
                return
        raise ValueError("unknown step")

    def history(self, service: str) -> list[str]:
        _given(service)
        return list(self._history.get(service, []))

    def rollback(self, service: str) -> str | None:
        _given(service)
        live = self._history.get(service, [])
        if len(live) < 2:
            return None
        live.pop()
        return live[-1]

    # The extension round: what a deploy would do right now, with nothing changed.
    def dryRun(self, service: str, version: str) -> list[str]:
        return self._run(service, version, False)

    def _run(self, service: str, version: str, real: bool) -> list[str]:
        _given(service)
        _given(version)
        release = f"{service}@{version}"
        lines: list[str] = []
        ran: list[Subsystem] = []
        for step in self._steps:
            if step.broken:
                if real:
                    step.broken = False
                lines.append(f"{step.run(release)} failed")
                return lines + [done.undo(release) for done in reversed(ran)]
            lines.append(step.run(release))
            ran.append(step)
        if real:
            self._history.setdefault(service, []).append(version)
        return lines
