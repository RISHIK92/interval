from __future__ import annotations


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("stage and job names are not empty")


class Pipeline:
    """The pipeline owns stages, a stage owns its jobs (composition); a job only names
    the jobs it needs (dependency), all in earlier stages, so a run goes in stage order."""

    def __init__(self) -> None:
        self._stages: list[str] = []
        self._jobs: dict[str, list[str]] = {}
        self._stage_of: dict[str, str] = {}
        self._needs: dict[str, list[str]] = {}
        self._failing: set[str] = set()
        self._allowed: set[str] = set()

    def _known(self, job: str) -> None:
        _named(job)
        if job not in self._stage_of:
            raise ValueError("unknown job")

    def stage(self, name: str) -> None:
        _named(name)
        if name in self._jobs:
            raise ValueError("stage already exists")
        self._stages.append(name)
        self._jobs[name] = []

    def job(self, stage: str, name: str, needs: list[str]) -> bool:
        _named(stage, name, *needs)
        if stage not in self._jobs:
            raise ValueError("unknown stage")
        if len(set(needs)) != len(needs):
            raise ValueError("a need is listed twice")
        if name in self._stage_of:
            return False
        earlier = self._stages[: self._stages.index(stage)]
        if any(self._stage_of.get(n) not in earlier for n in needs):
            return False
        self._jobs[stage].append(name)
        self._stage_of[name] = stage
        self._needs[name] = list(needs)
        return True

    def fail(self, job: str) -> None:
        self._known(job)
        self._failing.add(job)

    def _blocks(self, need: str, result: str) -> bool:
        return result == "skipped" or (result == "failed" and need not in self._allowed)

    def run(self) -> list[str]:
        outcome: dict[str, str] = {}
        for stage in self._stages:
            for job in self._jobs[stage]:
                if any(self._blocks(n, outcome[n]) for n in self._needs[job]):
                    outcome[job] = "skipped"
                elif job in self._failing:
                    outcome[job] = "failed"
                else:
                    outcome[job] = "passed"
        return [f"{job}: {result}" for job, result in outcome.items()]

    def removeStage(self, name: str) -> int:
        _named(name)
        if name not in self._jobs:
            raise ValueError("unknown stage")
        owned = set(self._jobs[name])
        for job, needs in self._needs.items():
            if job not in owned and owned.intersection(needs):
                raise ValueError("a later job needs this stage")
        for job in owned:
            del self._stage_of[job]
            del self._needs[job]
            self._failing.discard(job)
            self._allowed.discard(job)
        self._stages.remove(name)
        del self._jobs[name]
        return len(owned)

    # The extension round: an allowed failure doesn't skip the jobs that need it.
    def allowFailure(self, job: str) -> None:
        self._known(job)
        self._allowed.add(job)
