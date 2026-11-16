"""P6-W41 (CANVAS-6, AI-5; Q-P6-05): the judge's agreement with the owner's grades of
the calibration set and the resolved appeals."""

import json
from decimal import Decimal
from pathlib import Path

from interval_db.generated import AiProvider
from interval_jobs.adapters.memory import (
    InMemoryAi,
    InMemoryHldJudgements,
    InMemoryUsers,
)
from interval_jobs.ai.gateway import AiGateway
from interval_jobs.hld_judge_eval import Report, run_eval
from interval_jobs.ports import Completion, Message

from .test_pipeline import NOW
from .test_tagging_decide import NearWal

FILE = Path(__file__).parents[3] / "packages/hld/src/calibration.json"
CANDIDATES = {c["id"]: c for c in json.loads(FILE.read_text())}


class Fixed:
    """Grades every criterion at one level."""

    provider: AiProvider = "openrouter"

    def __init__(self, level: int) -> None:
        self.level = level
        self.calls = 0

    def complete(self, model: str, messages: list[Message]) -> Completion:
        self.calls += 1
        rubric = [
            line[2:].split(":")[0]
            for line in messages[0]["content"].splitlines()
            if line.startswith("- ")
        ]
        body = {c: {"level": self.level, "reason": "r"} for c in rubric}
        return Completion(json.dumps({"levels": body}), 900, 80, Decimal("0.0001"))


def grades(candidate: str, level: int) -> dict[str, int]:
    return {c["id"]: level for c in CANDIDATES[candidate]["input"]["rubric"]}


def gateway(llm: Fixed) -> AiGateway:
    return AiGateway(InMemoryAi(InMemoryUsers()), llm, NearWal(), clock=lambda: NOW)


def test_agreement_level_by_level_and_a_steered_injection() -> None:
    store = InMemoryHldJudgements()
    store.grades = {
        "url-shortener/reference": grades("url-shortener/reference", 3),
        "url-shortener/injection": grades("url-shortener/injection", 1),
        # Half graded: left out.
        "chat/naive": {next(iter(grades("chat/naive", 0))): 0},
    }
    llm = Fixed(3)
    report = run_eval(gateway(llm), "m", FILE, store)
    assert isinstance(report, Report)
    assert report.designs == 2
    assert report.exact == 0.5  # the reference agrees; the injection is 2 above
    assert report.within_one == 0.5
    assert report.steered == ["url-shortener/injection"]
    assert not report.passed
    assert llm.calls == 6  # two designs, three runs each


def test_resolved_appeals_join_the_set() -> None:
    store = InMemoryHldJudgements()
    given = CANDIDATES["news-feed/reference"]["input"]
    store.appeals = [(json.dumps(given), grades("news-feed/reference", 2))]
    report = run_eval(gateway(Fixed(2)), "m", FILE, store)
    assert isinstance(report, Report)
    assert (report.designs, report.exact, report.passed) == (1, 1.0, True)
