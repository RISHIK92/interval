"""The weekly difficulty recalibration (Q-3, Q-P2-19, P2-W9-S08): a Rasch fit over every
Test 60s answer; a question with enough answers takes the level its fitted difficulty
gives, and one almost everyone gets right or wrong is pulled for review. Until a
question has enough answers its starting level (Q-P2-11) stands, and when the fit
doesn't settle every level stands (logged)."""

from collections import defaultdict
from dataclasses import dataclass

from interval_db.generated import Difficulty
from interval_jobs import log
from interval_jobs.irt import fit_rasch, level_of
from interval_jobs.ports import Questions

MIN_ANSWERS = 30
ANOMALY_ABOVE = 0.98
ANOMALY_BELOW = 0.20


@dataclass(frozen=True)
class Recalibrated:
    recalibrated: int
    anomalies: int
    converged: bool
    components: int


def recalibrate(questions: Questions) -> Recalibrated:
    answers = questions.calibration_answers()
    seen: dict[int, int] = defaultdict(int)
    right: dict[int, int] = defaultdict(int)
    for a in answers:
        seen[a.item] += 1
        right[a.item] += a.correct
    enough = {item for item, n in seen.items() if n >= MIN_ANSWERS}
    fit = fit_rasch(answers)
    # Groups of questions no users share are each on their own users' scale.
    log.info(
        "recalibration: fitted", components=fit.components, items=len(fit.difficulties)
    )
    levels: dict[int, Difficulty] = {}
    if fit.converged:
        levels = {
            item: level_of(b) for item, b in fit.difficulties.items() if item in enough
        }
        # Everyone right, or everyone wrong: no finite difficulty, but a clear level.
        for item in enough - fit.difficulties.keys():
            if right[item] == seen[item]:
                levels[item] = "beginner"
            elif right[item] == 0:
                levels[item] = "advanced"
    else:
        log.warn("recalibration: fit did not settle; levels left as they are")
    odd = [
        item
        for item in sorted(enough)
        if not ANOMALY_BELOW <= right[item] / seen[item] <= ANOMALY_ABOVE
    ]
    return Recalibrated(
        questions.save_levels(levels),
        questions.queue_anomalies(odd),
        fit.converged,
        fit.components,
    )
