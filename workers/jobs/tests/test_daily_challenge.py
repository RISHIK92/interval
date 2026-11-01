"""The daily challenge's set (P3-W13-S05, Q-P3-06, ADR-0031): picked by one rule in
the database for the worker and the admin's swap; an unapproved set published at its
day's start joins the spot-check queue."""

from datetime import UTC, date, datetime, timedelta
from itertools import count

import psycopg
import pytest

from interval_db.generated import Difficulty, QuestionKind
from interval_jobs.adapters.memory import InMemoryStore
from interval_jobs.adapters.postgres import PostgresDailyChallenges, PostgresStore
from interval_jobs.daily_challenge import run_daily

DAY = date(2031, 3, 10)
_ids = count()


@pytest.fixture
def bank(conn: psycopg.Connection) -> psycopg.Connection:
    # Only this test's questions: the local bank's are set aside (rolled back).
    conn.execute("update question set status = 'retired' where status = 'live'")
    return conn


def moment(conn: psycopg.Connection, broken: bool = False) -> int:
    n = next(_ids)
    source_id = PostgresStore(conn).sources.upsert(
        name=f"daily-{n}",
        feed_url=f"https://daily.example.test/{n}",
        rights_profile="full_text_internal",
        homepage=None,
    )
    conn.execute(
        "update source set moments_seeded = true, moments_enabled = true where id = %s",
        (source_id,),
    )
    row = conn.execute(
        "insert into content_item (source_id, guid, canonical_url, title, "
        "link_broken_at) values (%s, 'g', 'https://daily.example.test/a', 't', "
        "case when %s then now() end) returning id",
        (source_id, broken),
    ).fetchone()
    assert row is not None
    row = conn.execute(
        "insert into moment (content_item_id, ordinal, title, estimated_minutes, "
        "link, link_type) values (%s, 0, 't', 1, 'https://daily.example.test/a', "
        "'page_top') returning id",
        (row[0],),
    ).fetchone()
    assert row is not None
    return row[0]


def concept(conn: psycopg.Connection) -> int:
    n = next(_ids)
    row = conn.execute(
        "insert into concept (slug, name, topic) values (%s, %s, 'databases') "
        "returning id",
        (f"daily-c{n}", f"Daily {n}"),
    ).fetchone()
    assert row is not None
    return row[0]


def question(
    conn: psycopg.Connection,
    kind: QuestionKind = "choice",
    concepts: list[int] | None = None,
    moment_id: int | None = None,
    difficulty: Difficulty | None = "intermediate",
    status: str = "live",
) -> int:
    concepts = [concept(conn)] if concepts is None else concepts
    if kind == "choice":
        row = conn.execute(
            "insert into question (moment_id, ordinal, stem, options, correct, "
            "citation, generator_model, prompt_version, content_hash, status, "
            "difficulty) values (%s, %s, 's', array['a','b','c','d'], 0, 'c', 'g', 1, "
            "'h', %s, %s) returning id",
            (moment_id or moment(conn), next(_ids), status, difficulty),
        ).fetchone()
    elif moment_id is None:
        row = conn.execute(
            "insert into question (kind, ordinal, stem, answer, unit, citation, "
            "source_url, source_title, status, difficulty) values ('estimate', %s, "
            "'How many?', 300, 'ms', 'about 300 ms', 'https://docs.example.test/x', "
            "'X', %s, %s) returning id",
            (next(_ids), status, difficulty),
        ).fetchone()
    else:
        row = conn.execute(
            "insert into question (kind, moment_id, ordinal, stem, answer, unit, "
            "citation, generator_model, prompt_version, content_hash, status, "
            "difficulty) values ('estimate', %s, 0, 'How many?', 300, 'ms', "
            "'about 300 ms', 'g', 1, 'h', %s, %s) returning id",
            (moment_id, status, difficulty),
        ).fetchone()
    assert row is not None
    for concept_id in concepts:
        conn.execute(
            "insert into question_concept (question_id, concept_id) values (%s, %s)",
            (row[0], concept_id),
        )
    return row[0]


def swap(conn: psycopg.Connection, day: date, position: int) -> bool:
    # The admin's swap (web); the same SQL function.
    row = conn.execute(
        "select daily_challenge_swap(%s, %s::smallint)", (day, position)
    ).fetchone()
    assert row is not None
    return row[0]


def the_set(conn: psycopg.Connection, day: date = DAY) -> list[tuple[int, int, str]]:
    return conn.execute(
        "select d.position, d.question_id, q.kind::text "
        "from daily_challenge_question d join question q on q.id = d.question_id "
        "where d.day = %s order by d.position",
        (day,),
    ).fetchall()


def test_a_set_is_3_choice_then_2_estimates(bank: psycopg.Connection) -> None:
    choices = {question(bank) for _ in range(4)}
    estimates = {question(bank, "estimate") for _ in range(3)}
    assert PostgresDailyChallenges(bank).pick(DAY)
    picked = the_set(bank)
    assert [kind for _, _, kind in picked] == ["choice"] * 3 + ["estimate"] * 2
    assert [p for p, _, _ in picked] == [0, 1, 2, 3, 4]
    assert {q for _, q, k in picked if k == "choice"} <= choices
    assert {q for _, q, k in picked if k == "estimate"} <= estimates


def test_estimate_slots_the_bank_cant_fill_take_multiple_choice(
    bank: psycopg.Connection,
) -> None:
    for _ in range(5):
        question(bank)
    question(bank, "estimate")
    assert PostgresDailyChallenges(bank).pick(DAY)
    assert [k for _, _, k in the_set(bank)] == ["choice"] * 3 + ["estimate", "choice"]


def test_a_small_bank_makes_a_short_set(bank: psycopg.Connection) -> None:
    question(bank)
    question(bank)
    assert PostgresDailyChallenges(bank).pick(DAY)
    assert len(the_set(bank)) == 2


def test_a_day_is_picked_once(bank: psycopg.Connection) -> None:
    for _ in range(6):
        question(bank)
    daily = PostgresDailyChallenges(bank)
    assert daily.pick(DAY)
    first = the_set(bank)
    assert not daily.pick(DAY)
    assert the_set(bank) == first


def test_the_five_test_different_concepts(bank: psycopg.Connection) -> None:
    shared = concept(bank)
    one = question(bank, concepts=[shared])
    two = question(bank, concepts=[shared, concept(bank)])
    others = {question(bank) for _ in range(3)}
    assert PostgresDailyChallenges(bank).pick(DAY)
    picked = {q for _, q, _ in the_set(bank)}
    assert len(picked) == 4
    assert others < picked
    assert len(picked & {one, two}) == 1


def test_only_questions_rounds_may_serve(bank: psycopg.Connection) -> None:
    allowed = question(bank)
    # A moment whose source's rights drop is purged with its questions (ING-2, a
    # trigger), so what's left to leave out is the status and a broken link.
    question(bank, status="flagged")
    question(bank, "estimate", moment_id=moment(bank, broken=True))
    # A broken link still serves multiple choice, as quizzes' LIVE does.
    choice_on_broken = question(bank, moment_id=moment(bank, broken=True))
    estimate_in_moment = question(bank, "estimate", moment_id=moment(bank))
    assert PostgresDailyChallenges(bank).pick(DAY)
    assert {q for _, q, _ in the_set(bank)} == {
        allowed,
        choice_on_broken,
        estimate_in_moment,
    }


def test_no_repeat_within_30_days(bank: psycopg.Connection) -> None:
    daily = PostgresDailyChallenges(bank)
    used = question(bank)
    assert daily.pick(DAY - timedelta(days=30))
    assert the_set(bank, DAY - timedelta(days=30)) == [(0, used, "choice")]
    fresh = question(bank)
    assert daily.pick(DAY)
    assert the_set(bank) == [(0, fresh, "choice")]
    assert daily.pick(DAY + timedelta(days=30))
    assert {q for _, q, _ in the_set(bank, DAY + timedelta(days=30))} == {used}


def test_intermediate_comes_first_then_unlevelled(bank: psycopg.Connection) -> None:
    advanced = question(bank, difficulty="advanced")
    unlevelled = question(bank, difficulty=None)
    middle = {question(bank) for _ in range(2)}
    daily = PostgresDailyChallenges(bank)
    assert daily.pick(DAY)
    assert [q for _, q, _ in the_set(bank)][:2] in (list(middle), list(middle)[::-1])
    assert [q for _, q, _ in the_set(bank)][2:] == [unlevelled, advanced]


def test_swap_keeps_the_kind_and_the_concepts_apart(bank: psycopg.Connection) -> None:
    taken = concept(bank)
    question(bank, concepts=[taken])
    question(bank, "estimate")
    daily = PostgresDailyChallenges(bank)
    future = date.today() + timedelta(days=2)
    assert daily.pick(future)
    before = the_set(bank, future)
    clash = question(bank, "estimate", concepts=[taken])
    assert not swap(bank, future, 1)  # only one that clashes with position 0
    replacement = question(bank, "estimate")
    question(bank)  # the wrong kind
    assert swap(bank, future, 1)
    assert the_set(bank, future) == [before[0], (1, replacement, "estimate")]
    assert clash not in {q for _, q, _ in the_set(bank, future)}


def test_a_started_day_cant_be_swapped(bank: psycopg.Connection) -> None:
    question(bank)
    question(bank)
    daily = PostgresDailyChallenges(bank)
    today = datetime.now(UTC).date()
    assert daily.pick(today)
    assert not swap(bank, today, 0)
    assert not swap(bank, today + timedelta(days=1), 0)  # no set: nothing to swap


def test_an_unapproved_set_is_queued_for_review_once(bank: psycopg.Connection) -> None:
    ids = {question(bank) for _ in range(2)}
    daily = PostgresDailyChallenges(bank)
    assert daily.pick(DAY)
    assert set(daily.publish_unreviewed(DAY) or []) == ids
    assert daily.publish_unreviewed(DAY) is None
    assert bank.execute(
        "select question_id, reason::text from question_review "
        "where question_id = any(%s) order by 1",
        (list(ids),),
    ).fetchall() == [(i, "daily") for i in sorted(ids)]


def test_an_approved_set_isnt_queued(bank: psycopg.Connection) -> None:
    question(bank)
    daily = PostgresDailyChallenges(bank)
    assert daily.pick(DAY)
    bank.execute(
        "update daily_challenge set approved_at = now() where day = %s", (DAY,)
    )
    assert daily.publish_unreviewed(DAY) is None


def test_a_question_already_in_review_stays_queued_once(
    bank: psycopg.Connection,
) -> None:
    flagged = question(bank)
    bank.execute(
        "insert into question_review (question_id, reason) values (%s, 'flagged')",
        (flagged,),
    )
    daily = PostgresDailyChallenges(bank)
    assert daily.pick(DAY)
    assert daily.publish_unreviewed(DAY) == []
    assert bank.execute(
        "select reason::text from question_review where question_id = %s", (flagged,)
    ).fetchall() == [("flagged",)]


def test_the_job_picks_today_if_missing_flags_it_and_picks_tomorrow() -> None:
    store = InMemoryStore()
    now = datetime(2031, 3, 10, 0, 0, 5, tzinfo=UTC)
    store.daily.questions = [7, 8]
    assert run_daily(store, now) == {
        "picked_today": True,
        "published_unreviewed": 2,
        "picked_tomorrow": True,
    }
    assert set(store.daily.days) == {date(2031, 3, 10), date(2031, 3, 11)}
    assert store.daily.queued == [7, 8]
    # A second run changes nothing.
    assert run_daily(store, now) == {
        "picked_today": False,
        "published_unreviewed": None,
        "picked_tomorrow": False,
    }
    assert store.daily.queued == [7, 8]


def test_the_job_leaves_an_approved_day_alone() -> None:
    store = InMemoryStore()
    now = datetime(2031, 3, 10, 0, 0, 5, tzinfo=UTC)
    store.daily.pick(date(2031, 3, 10))
    store.daily.approved.add(date(2031, 3, 10))
    assert run_daily(store, now)["published_unreviewed"] is None
    assert store.daily.queued == []
