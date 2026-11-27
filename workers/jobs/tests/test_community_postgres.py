"""Community questions on the real schema (Q-P7-05, owner 2026-11-27): a player's
question has exactly its own shape, numbers its slots apart from the model's, and the
check's verdict sends it to the owner's queue or rejects it, never live. The drafted
bank's statements and the daily challenge's pick leave it alone."""

import uuid
from datetime import date
from typing import LiteralString

import psycopg
import pytest

from interval_jobs.adapters.postgres import PostgresPaths, PostgresQuestions
from interval_jobs.ports import CommunityDraft, QuestionDraft


def _section(conn: psycopg.Connection) -> tuple[int, str, str]:
    """A tagged section of a full-text source, its concept's slug, and an author."""
    tag = uuid.uuid4().hex[:12]
    source = conn.execute(
        "insert into source (name, feed_url, rights_profile, moments_enabled, "
        "moments_seeded) values (%s, %s, 'full_text_internal', true, true) "
        "returning id",
        (f"community-{tag}", f"https://{tag}.test/feed"),
    ).fetchone()
    assert source is not None
    item = conn.execute(
        "insert into content_item (source_id, guid, canonical_url, title) "
        "values (%s, %s, %s, 'Article') returning id",
        (source[0], tag, f"https://{tag}.test/a"),
    ).fetchone()
    assert item is not None
    moment = conn.execute(
        "insert into moment (content_item_id, ordinal, title, estimated_minutes, link, "
        "link_type) values (%s, 0, 'Section', 3, %s, 'anchor') returning id",
        (item[0], f"https://{tag}.test/a#s"),
    ).fetchone()
    assert moment is not None
    slug = f"community-{tag}"
    concept = conn.execute(
        "insert into concept (slug, name, topic) values (%s, 'C', 'databases') "
        "returning id",
        (slug,),
    ).fetchone()
    assert concept is not None
    conn.execute(
        "insert into moment_tagging (moment_id, difficulty) values (%s, 'beginner')",
        (moment[0],),
    )
    conn.execute(
        "insert into moment_concept (moment_id, concept_id) values (%s, %s)",
        (moment[0], concept[0]),
    )
    author = f"author-{tag}"
    conn.execute(
        "insert into app_user (id, name, email, email_verified) "
        "values (%s, 'A', %s, true)",
        (author, f"{author}@example.test"),
    )
    return int(moment[0]), slug, author


def _community(
    conn: psycopg.Connection,
    moment_id: int,
    author: str,
    ordinal: int = 0,
    status: str = "pending",
) -> int:
    row = conn.execute(
        """
        insert into question (moment_id, ordinal, stem, options, correct, citation,
          status, author_user_id, submission_key)
        values (%s, %s, 'What does it do?', array['It', 'b', 'c', 'd'], 0,
          'a quote here', %s::question_status, %s, %s)
        returning id
        """,
        (moment_id, ordinal, status, author, uuid.uuid4().hex),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _drafted(conn: psycopg.Connection, moment_id: int, status: str = "live") -> int:
    row = conn.execute(
        """
        insert into question (moment_id, ordinal, stem, options, correct, citation,
          status, generator_model, prompt_version, content_hash)
        values (%s, 0, 'Drafted?', array['It', 'b', 'c', 'd'], 0, 'a quote here',
          %s::question_status, 'm', 1, 'h')
        returning id
        """,
        (moment_id, status),
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_a_community_question_has_its_own_shape(conn: psycopg.Connection) -> None:
    moment_id, _, author = _section(conn)
    # Slots apart: the model's slot 0 and a player's slot 0 on one section.
    _drafted(conn, moment_id)
    _community(conn, moment_id, author)
    bad: list[LiteralString] = [
        # a second player's question in the same community slot
        "insert into question (moment_id, ordinal, stem, options, correct, citation, "
        "author_user_id, submission_key) values (%(m)s, 0, 's', array['a','b','c','d'],"
        " 0, 'c', %(a)s, 'k2')",
        # no submission key
        "insert into question (moment_id, ordinal, stem, options, correct, citation, "
        "author_user_id) values (%(m)s, 1, 's', array['a','b','c','d'], 0, 'c', %(a)s)",
        # a model too
        "insert into question (moment_id, ordinal, stem, options, correct, citation, "
        "author_user_id, submission_key, generator_model, prompt_version, "
        "content_hash) values (%(m)s, 1, 's', array['a','b','c','d'], 0, 'c', %(a)s, "
        "'k3', 'm', 1, 'h')",
        # an estimate
        "insert into question (kind, moment_id, ordinal, stem, answer, unit, "
        "citation, author_user_id, submission_key) values ('estimate', %(m)s, 1, 's', "
        "3, 'ms', 'c', %(a)s, 'k4')",
    ]
    for statement in bad:
        with pytest.raises(psycopg.errors.IntegrityError), conn.transaction():
            conn.execute(statement, {"m": moment_id, "a": author})


def test_the_check_sends_an_agreeing_question_to_the_owner_never_live(
    conn: psycopg.Connection,
) -> None:
    moment_id, _, author = _section(conn)
    questions = PostgresQuestions(conn)
    agreed = _community(conn, moment_id, author, 0)
    disagreed = _community(conn, moment_id, author, 1)
    assert questions.pending_community(agreed) == CommunityDraft(
        moment_id,
        QuestionDraft("What does it do?", ("It", "b", "c", "d"), 0, "a quote here"),
        author,
    )
    # The drafted bank's path doesn't see it.
    assert questions.pending(agreed) is None
    assert not questions.record_verdict(agreed, "m", 0)
    assert agreed not in {qid for qid, _ in questions.pending_questions()}
    assert questions.record_community_verdict(agreed, "v", 0) == "review"
    assert questions.record_community_verdict(disagreed, "v", 2) == "rejected"
    rows = conn.execute(
        "select id, status, validator_model, validator_answer from question "
        "where id = any(%s) order by id",
        ([agreed, disagreed],),
    ).fetchall()
    assert rows == [(agreed, "pending", "v", 0), (disagreed, "rejected", "v", 2)]
    reviews = conn.execute(
        "select question_id, reason, decision from question_review "
        "where question_id = any(%s)",
        ([agreed, disagreed],),
    ).fetchall()
    assert reviews == [(agreed, "community", None)]
    # Checked once: a repeat delivery changes nothing.
    assert questions.pending_community(agreed) is None
    assert questions.record_community_verdict(agreed, "v", 0) is None
    assert questions.pending_ids(moment_id) == []


def test_a_redraft_and_the_rewrites_leave_a_players_question_alone(
    conn: psycopg.Connection,
) -> None:
    moment_id, slug, author = _section(conn)
    questions = PostgresQuestions(conn)
    mine = _community(conn, moment_id, author, status="live")
    # Only a player's question: the section was never drafted.
    assert questions.drafted_hash(moment_id) is None
    draft = QuestionDraft("New?", ("It", "b", "c", "d"), 0, "a quote here")
    questions.save(moment_id, [draft], [slug], "m", 1, "h2", None)
    assert questions.drafted_hash(moment_id) == "h2"
    status = conn.execute("select status from question where id = %s", (mine,))
    assert status.fetchone() == ("live",)
    assert mine not in {c.question_id for c in questions.stem_candidates()}


def test_the_daily_challenge_and_path_checkpoints_never_pick_one(
    conn: psycopg.Connection,
) -> None:
    moment_id, slug, author = _section(conn)
    # Only this section's questions are live here (rolled back with the test).
    conn.execute("update question set status = 'retired' where status = 'live'")
    _community(conn, moment_id, author, status="live")
    day = date(2099, 1, 1)
    fit = "select daily_challenge_fit(%s, 'choice', null)"
    assert conn.execute(fit, (day,)).fetchone() == (None,)
    candidates = PostgresPaths(conn).session_candidates([slug])
    assert [c.live_questions for c in candidates] == [False]
    drafted = _drafted(conn, moment_id)
    assert conn.execute(fit, (day,)).fetchone() == (drafted,)
    candidates = PostgresPaths(conn).session_candidates([slug])
    assert [c.live_questions for c in candidates] == [True]


def test_a_quote_not_in_its_section_is_rejected_unchecked(
    conn: psycopg.Connection,
) -> None:
    moment_id, _, author = _section(conn)
    questions = PostgresQuestions(conn)
    mine = _community(conn, moment_id, author)
    assert questions.reject_community(mine, "not_stand_alone")
    assert not questions.reject_community(mine, "not_quoted")
    row = conn.execute(
        "select status, rejected_because, validated_at from question where id = %s",
        (mine,),
    ).fetchone()
    assert row == ("rejected", "not_stand_alone", None)


# Owner, 2026-11-27: an author who leaves leaves the question, authorless, with other
# players' answers and its review history; it stays a community question, served
# nowhere until W51.
def test_an_author_who_leaves_leaves_the_question_and_its_answers(
    conn: psycopg.Connection,
) -> None:
    moment_id, slug, author = _section(conn)
    conn.execute("update question set status = 'retired' where status = 'live'")
    mine = _community(conn, moment_id, author, status="live")
    conn.execute(
        "insert into question_review (question_id, reason, decision, decided_by, "
        "decided_at) values (%s, 'community', 'approve', 'owner-1', now())",
        (mine,),
    )
    conn.execute(
        "insert into app_user (id, name, email) values ('reader-1', 'R', "
        "'reader-1@example.test')"
    )
    attempt = conn.execute(
        "insert into quiz_attempt (user_id, review) values ('reader-1', true) "
        "returning id"
    ).fetchone()
    assert attempt is not None
    conn.execute(
        "insert into quiz_answer (attempt_id, question_id, served_at, answered_at, "
        "chosen, correct) values (%s, %s, now(), now(), 0, true)",
        (attempt[0], mine),
    )
    conn.execute("delete from app_user where id = %s", (author,))
    row = conn.execute(
        "select status, author_user_id, submission_key is not null from question "
        "where id = %s",
        (mine,),
    ).fetchone()
    assert row == ("live", None, True)
    assert conn.execute(
        "select count(*) from quiz_answer where question_id = %s", (mine,)
    ).fetchone() == (1,)
    assert conn.execute(
        "select count(*) from question_review where question_id = %s", (mine,)
    ).fetchone() == (1,)
    # Still a community question: the daily pick and checkpoints pass it over.
    fit = "select daily_challenge_fit(%s, 'choice', null)"
    assert conn.execute(fit, (date(2099, 1, 1),)).fetchone() == (None,)
    candidates = PostgresPaths(conn).session_candidates([slug])
    assert [c.live_questions for c in candidates] == [False]
