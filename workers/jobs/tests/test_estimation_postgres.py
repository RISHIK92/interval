"""Hand-written estimation questions (P3-W13-S03, Q-P3-05 (b)) on the real schema:
the owner writes them live, with no validator, and the weekly spot check (Q-2) still
samples them like any other."""

from datetime import UTC, datetime, timedelta

import psycopg

from interval_jobs.adapters.postgres import PostgresQuestions


def test_a_hand_written_question_is_in_the_weekly_sample(
    conn: psycopg.Connection,
) -> None:
    since = datetime.now(UTC) - timedelta(seconds=1)
    row = conn.execute(
        """
        insert into question (kind, ordinal, stem, answer, unit, citation,
          source_url, source_title, status)
        values ('estimate', 0, 'How many?', 300, 'ms', 'about 300 ms',
          'https://docs.example.test/x', 'X', 'live')
        returning id
        """
    ).fetchone()
    assert row is not None
    # Everything new since `since` is sampled at a share of 1.
    PostgresQuestions(conn).queue_spot_checks(since, 1.0)
    assert conn.execute(
        "select reason from question_review where question_id = %s", (row[0],)
    ).fetchall() == [("sample",)]
