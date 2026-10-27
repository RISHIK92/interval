"""Difficulty from real answers (Q-3, Q-P2-19, P2-W9-S08): a one-parameter (Rasch)
fit and the level it gives a question. Pure: no database."""

import math
import random

import pytest

from interval_jobs.irt import Answer, fit_rasch, level_of


def chance(theta: float, b: float) -> float:
    return 1 / (1 + math.exp(-(theta - b)))


def crossed(
    abilities: dict[str, float], difficulties: dict[int, float], seed: int = 7
) -> list[Answer]:
    rng = random.Random(seed)
    return [
        Answer(person, item, rng.random() < chance(theta, b))
        for person, theta in abilities.items()
        for item, b in difficulties.items()
    ]


def sparse(
    people: int, bank: dict[int, float], each: int, shift: float = 0.0, seed: int = 3
) -> list[Answer]:
    """Each person answers `each` random questions: how real quizzes look."""
    rng = random.Random(seed)
    items = list(bank)
    answers: list[Answer] = []
    for p in range(people):
        theta = rng.gauss(shift, 1)
        for item in rng.sample(items, each):
            answers.append(
                Answer(f"u{p}", item, rng.random() < chance(theta, bank[item]))
            )
    return answers


def slope(truth: dict[int, float], fitted: dict[int, float]) -> float:
    xs = [truth[i] for i in fitted]
    ys = [fitted[i] for i in fitted]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / sum(
        (x - mx) ** 2 for x in xs
    )


def test_the_fit_orders_items_by_how_hard_they_really_are() -> None:
    rng = random.Random(1)
    abilities = {f"u{i}": rng.gauss(0, 1) for i in range(300)}
    truth = {1: -1.5, 2: -0.5, 3: 0.0, 4: 0.7, 5: 1.6}
    fit = fit_rasch(crossed(abilities, truth))
    assert fit.converged
    assert sorted(fit.difficulties, key=fit.difficulties.__getitem__) == [1, 2, 3, 4, 5]
    for item, b in truth.items():
        assert fit.difficulties[item] == pytest.approx(b, abs=0.35)


def test_few_answers_per_person_are_not_inflated() -> None:
    # Joint maximum likelihood inflates difficulties when each person answers few
    # questions; the correction is by answers per person, not the bank's size.
    rng = random.Random(5)
    bank = {i: rng.uniform(-2, 2) for i in range(50)}
    for each in (4, 6):
        fit = fit_rasch(sparse(3000, bank, each))
        assert fit.converged
        assert slope(bank, fit.difficulties) == pytest.approx(1.0, abs=0.15)


def test_people_who_got_everything_right_still_set_the_scale() -> None:
    # Easy questions: many users get all of theirs right. Leaving them out of the
    # centring would make every question look harder than it is.
    rng = random.Random(9)
    bank = {i: rng.uniform(-2.5, 0.5) for i in range(40)}
    fit = fit_rasch(sparse(3000, bank, 6))
    errors = [fit.difficulties[i] - bank[i] for i in fit.difficulties]
    assert abs(sum(errors) / len(errors)) < 0.2


def test_groups_with_no_users_in_common_are_fitted_apart() -> None:
    rng = random.Random(2)
    left = {i: -1.5 + rng.uniform(-0.3, 0.3) for i in range(10)}
    right = {i: 1.5 + rng.uniform(-0.3, 0.3) for i in range(10, 20)}
    answers = sparse(800, left, 5, shift=0.0, seed=4) + [
        Answer(f"r-{a.person}", a.item, a.correct)
        for a in sparse(800, right, 5, shift=0.0, seed=6)
    ]
    fit = fit_rasch(answers)
    assert fit.components == 2
    # Each group against its own users: easy for them on the left, hard on the right.
    assert all(fit.difficulties[i] < -0.5 for i in left)
    assert all(fit.difficulties[i] > 0.5 for i in right)


def test_a_fit_that_does_not_settle_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    rng = random.Random(1)
    abilities = {f"u{i}": rng.gauss(0, 1) for i in range(50)}
    monkeypatch.setattr("interval_jobs.irt.MAX_ITERATIONS", 1)
    assert fit_rasch(crossed(abilities, {1: -1.0, 2: 1.0})).converged is False


def test_no_informative_answers_fit_nothing() -> None:
    assert fit_rasch([]).difficulties == {}
    everyone_right = [Answer(f"u{i}", 1, True) for i in range(40)]
    assert fit_rasch(everyone_right).difficulties == {}


@pytest.mark.parametrize(
    ("b", "level"),
    [
        (-2.0, "beginner"),
        (-0.51, "beginner"),
        (-0.5, "intermediate"),
        (0.0, "intermediate"),
        (0.5, "intermediate"),
        (0.51, "advanced"),
    ],
)
def test_a_difficulty_maps_to_a_level(b: float, level: str) -> None:
    assert level_of(b) == level
