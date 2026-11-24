"""P6-W42 (MATCH-1, Q-P6-06, ADR-0043): a scored HLD match's ratings, from the places
the web app set, in HLD's own tables, once."""

import psycopg

from interval_jobs.adapters.postgres import PostgresHldMatches

from .test_db_guards import a_user


def match(
    conn: psycopg.Connection, places: dict[str, int], *, unrated: bool = False
) -> str:
    for user in places:
        a_user(conn, user)
    row = conn.execute(
        "insert into hld_match (family, battle_mode, seed, spec, unrated,"
        " deadline_at, closed_at, scored_at, rubric_included)"
        " values ('chat', 'human', 3, '1.0', %s, now() + interval '30 minutes',"
        " now(), now(), true) returning id::text",
        (unrated,),
    ).fetchone()
    assert row is not None
    for user, place in places.items():
        conn.execute(
            "insert into hld_match_player (match_id, user_id, place)"
            " values (%s::uuid, %s, %s)",
            (row[0], user, place),
        )
    return str(row[0])


def test_a_duel_is_rated_once_by_glicko(conn: psycopg.Connection) -> None:
    id_ = match(conn, {"hlda": 1, "hldb": 2})
    matches = PostgresHldMatches(conn)
    assert matches.rate(id_)
    assert not matches.rate(id_)
    rows = dict(
        conn.execute(
            "select user_id, rating from hld_rating where battle_mode = 'human'"
            " and user_id in ('hlda', 'hldb')"
        ).fetchall()
    )
    assert rows["hlda"] > 1500 > rows["hldb"]
    scores = dict(
        conn.execute(
            "select user_id, score from hld_rating_history where match_id = %s::uuid",
            (id_,),
        ).fetchall()
    )
    assert scores == {"hlda": 1.0, "hldb": 0.0}
    # LLD's battle ratings are untouched.
    assert conn.execute(
        "select count(*) from battle_rating where user_id in ('hlda', 'hldb')"
    ).fetchone() == (0,)


def test_a_room_is_rated_by_openskill(conn: psycopg.Connection) -> None:
    id_ = match(conn, {"hldc": 2, "hldd": 1, "hlde": 3})
    assert PostgresHldMatches(conn).rate(id_)
    ranks = dict(
        conn.execute(
            "select user_id, rank from hld_room_rating_history"
            " where match_id = %s::uuid",
            (id_,),
        ).fetchall()
    )
    assert ranks == {"hldc": 2, "hldd": 1, "hlde": 3}


def test_unrated_or_solo_matches_are_left_alone(conn: psycopg.Connection) -> None:
    matches = PostgresHldMatches(conn)
    assert not matches.rate(match(conn, {"hldf": 1, "hldg": 2}, unrated=True))
    solo = match(conn, {"hldh": 1})
    assert not matches.rate(solo)
    assert conn.execute(
        "select rated_at is not null from hld_match where id = %s::uuid", (solo,)
    ).fetchone() == (True,)
