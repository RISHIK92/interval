from __future__ import annotations

CAPABILITIES = frozenset({"build", "test", "deploy", "gpu"})


def _given(value: str) -> None:
    if value == "":
        raise ValueError("empty name")


def _known(capabilities: list[str]) -> frozenset[str]:
    found = frozenset(capabilities)
    if not found <= CAPABILITIES:
        raise ValueError("unknown capability")
    return found


class Runner:
    """There is deliberately no runner interface with build, test, deploy and gpu methods,
    which would force a build-only runner to stub a deploy. A runner holds only the
    capabilities it really has, and a job is matched against just the ones it needs."""

    def __init__(self, capabilities: frozenset[str]) -> None:
        self.capabilities = capabilities
        self.job: str | None = None
        self.draining = False

    def takes(self, needs: frozenset[str]) -> bool:
        return self.job is None and not self.draining and needs <= self.capabilities


class RunnerPool:
    def __init__(self) -> None:
        self._runners: dict[str, Runner] = {}
        self._jobs: dict[str, str] = {}

    def addRunner(self, name: str, capabilities: list[str]) -> None:
        _given(name)
        if name in self._runners:
            raise ValueError("runner already in the pool")
        self._runners[name] = Runner(_known(capabilities))

    def assign(self, job: str, needs: list[str]) -> str | None:
        _given(job)
        wanted = _known(needs)
        if job in self._jobs:
            raise ValueError("job already running")
        for name, runner in self._runners.items():
            if runner.takes(wanted):
                runner.job = job
                self._jobs[job] = name
                return name
        return None

    def finish(self, job: str) -> bool:
        _given(job)
        name = self._jobs.pop(job, None)
        if name is None:
            return False
        runner = self._runners[name]
        runner.job = None
        self._leave_if_drained(name)
        return True

    def busy(self) -> list[str]:
        return sorted(self._jobs.values())

    # The extension round: a runner on its way out.
    def drain(self, name: str) -> None:
        _given(name)
        if name not in self._runners:
            raise ValueError("no such runner")
        self._runners[name].draining = True
        self._leave_if_drained(name)

    def _leave_if_drained(self, name: str) -> None:
        runner = self._runners[name]
        if runner.draining and runner.job is None:
            del self._runners[name]
