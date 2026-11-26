from __future__ import annotations

STEPS = ["checkout", "setup", "install", "test", "report"]
HOOKS = {"setup", "install"}


class Job:
    """The template: run() fixes the skeleton and its rules (skipped hooks, stopping at
    a failure, report always running), and each kind fills in only its own commands.
    setup and install are hooks: a kind that doesn't override one has no such step."""

    def checkout(self) -> str:
        return "git checkout"

    def setup(self) -> str | None:
        """No setup step unless the kind has one."""

    def install(self) -> str | None:
        """No install step unless the kind has one."""

    def test(self) -> str:
        raise NotImplementedError

    def report(self) -> str:
        return "publish results"

    def run(self, skipped: set[str], failAt: str, before: list[str]) -> list[str]:
        commands = {
            "checkout": self.checkout(),
            "setup": self.setup(),
            "install": self.install(),
            "test": self.test(),
            "report": self.report(),
        }
        log: list[str] = []
        failed = False
        for step in STEPS:
            command = commands[step]
            if command is None or step in skipped or (failed and step != "report"):
                continue
            log.extend(f"before {step}: {hook}" for hook in before)
            if step == failAt:
                failed = True
                command += " [failed]"
            log.append(f"{step}: {command}")
        return log


class NodeJob(Job):
    def setup(self) -> str | None:
        return "nvm use"

    def install(self) -> str | None:
        return "npm ci"

    def test(self) -> str:
        return "npm test"


class PythonJob(Job):
    def setup(self) -> str | None:
        return "python -m venv .venv"

    def install(self) -> str | None:
        return "pip install -r requirements.txt"

    def test(self) -> str:
        return "pytest"


class GoJob(Job):
    def install(self) -> str | None:
        return "go mod download"

    def test(self) -> str:
        return "go test ./..."


KINDS: dict[str, type[Job]] = {"node": NodeJob, "python": PythonJob, "go": GoJob}


class JobRunner:
    """Runs CI jobs of every kind through the one template, with the steps skipped and
    the commands to run before each step shared by all kinds."""

    def __init__(self) -> None:
        self._skipped: set[str] = set()
        self._before: list[str] = []

    def steps(self, kind: str) -> list[str]:
        return self._job(kind).run(self._skipped, "", self._before)

    def skip(self, step: str) -> None:
        if step not in HOOKS:
            raise ValueError("only a hook can be skipped")
        self._skipped.add(step)

    def runJob(self, kind: str, failAt: str) -> list[str]:
        job = self._job(kind)
        if failAt != "" and failAt not in STEPS:
            raise ValueError("unknown step")
        return job.run(self._skipped, failAt, self._before)

    # The extension round: a command before every step.
    def beforeEach(self, command: str) -> None:
        if command == "":
            raise ValueError("empty command")
        self._before.append(command)

    @staticmethod
    def _job(kind: str) -> Job:
        make = KINDS.get(kind)
        if make is None:
            raise ValueError("unknown kind")
        return make()
