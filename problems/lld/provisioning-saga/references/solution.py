from __future__ import annotations

FAILED = "fail:"
STEPS = ["create-user", "create-repo", "grant-access", "send-welcome"]
MAX_TIMES = 1000


class Step:
    """A command with its compensation. Each returns what it did, for the trail; an
    injected failure count makes the next attempts fail."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.failures = 0

    def execute(self) -> str:
        if self.failures == 0:
            return "do:" + self.name
        self.failures -= 1
        return FAILED + self.name

    def compensate(self) -> str:
        return "undo:" + self.name


class Saga:
    """One account's run: the steps done, in order, and everything that happened."""

    def __init__(self) -> None:
        self.done: list[Step] = []
        self.trail: list[str] = []
        self.status = ""

    def resume(self, steps: list[Step], pivot: Step | None) -> None:
        # Done steps are skipped, so a retry carries on where the last run stopped and a
        # completed saga runs nothing.
        for step in steps[len(self.done) :]:
            entry = step.execute()
            self.trail.append(entry)
            if entry.startswith(FAILED):
                self._failed(pivot)
                return
            self.done.append(step)
        self.status = "completed"

    def _failed(self, pivot: Step | None) -> None:
        if pivot is not None and pivot in self.done:
            self.status = "pending"
            return
        for step in reversed(self.done):
            self.trail.append(step.compensate())
        self.done = []
        self.status = "compensated"


class ProvisioningSaga:
    def __init__(self) -> None:
        self._steps = [Step(name) for name in STEPS]
        self._sagas: dict[str, Saga] = {}
        self._pivot: Step | None = None

    def failStep(self, step: str, times: int) -> None:
        found = self._step(step)
        if times < 0 or times > MAX_TIMES:
            raise ValueError("times runs from 0 to 1000")
        found.failures = times

    def start(self, account: str) -> str:
        if account == "":
            raise ValueError("an empty account")
        saga = self._sagas.get(account)
        if saga is None:
            saga = Saga()
            self._sagas[account] = saga
            saga.resume(self._steps, self._pivot)
        return saga.status

    def retry(self, account: str) -> str:
        saga = self._saga(account)
        saga.resume(self._steps, self._pivot)
        return saga.status

    def trail(self, account: str) -> list[str]:
        return list(self._saga(account).trail)

    def status(self, account: str) -> str:
        return self._saga(account).status

    # The extension round: a pivot step, past which the saga only moves forward.
    def pivot(self, step: str) -> None:
        self._pivot = self._step(step)

    def _step(self, name: str) -> Step:
        for step in self._steps:
            if step.name == name:
                return step
        raise KeyError("no such step")

    def _saga(self, account: str) -> Saga:
        saga = self._sagas.get(account)
        if saga is None:
            raise KeyError("no such account")
        return saga
