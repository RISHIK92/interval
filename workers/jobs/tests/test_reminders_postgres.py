"""Opt-in pushes in Postgres (P4-W24-S01b; owner, 2026-11-11): who wants them, what
applies now (today's daily unplayed, a path quiet for two days, an unopened feed entry),
and the day's one claim."""

from datetime import UTC, date, datetime, timedelta

import psycopg

from interval_jobs.adapters.postgres import PostgresReminders
from interval_jobs.ports import PushCandidate, PushNotice

from .test_db_guards import a_user

NOW = datetime(2026, 11, 11, 12, 30, tzinfo=UTC)
# A day no real set uses: the table is shared with the daily challenge's own tests.
FAR = date(2099, 1, 1)


def _source(conn: psycopg.Connection, name: str) -> int:
    row = conn.execute(
        "insert into source (name, feed_url, rights_profile, moments_enabled, "
        "moments_seeded) values (%s, %s, 'full_text_internal', true, true) "
        "returning id",
        (f"src-{name}", f"https://{name}.test/feed"),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _moment(conn: psycopg.Connection, source: int, name: str) -> tuple[int, int]:
    item = conn.execute(
        "insert into content_item (source_id, guid, canonical_url, title) "
        "values (%s, %s, %s, %s) returning id",
        (source, name, f"https://x.test/{name}", f"Article {name}"),
    ).fetchone()
    assert item is not None
    moment = conn.execute(
        "insert into moment (content_item_id, ordinal, title, estimated_minutes, link, "
        "link_type) values (%s, 0, %s, 3, %s, 'anchor') returning id",
        (item[0], f"Section {name}", f"https://x.test/{name}#s"),
    ).fetchone()
    assert moment is not None
    return int(item[0]), int(moment[0])


def _wants(conn: psycopg.Connection, user: str) -> None:
    conn.execute(
        "insert into push_preference (user_id, digest, path_reminder, daily_challenge,"
        " hour, time_zone) values (%s, true, true, false, 9, 'Asia/Kolkata')",
        (user,),
    )


def test_candidates_have_a_kind_on_and_a_plan_with_push(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "rm1")
    a_user(conn, "rm2")
    _wants(conn, "rm1")
    conn.execute(
        "insert into push_preference (user_id, time_zone) values ('rm2', 'UTC')"
    )
    store = PostgresReminders(conn)
    mine = [c for c in store.candidates() if c.user_id in ("rm1", "rm2")]
    assert mine == [PushCandidate("rm1", "Asia/Kolkata", 9, False, True, True)]
    conn.execute(
        "delete from plan_capability "
        "where plan_id = 'beta' and capability = 'push.notify'"
    )
    assert not [c for c in store.candidates() if c.user_id == "rm1"]


def test_the_daily_is_open_until_an_attempt_on_it(conn: psycopg.Connection) -> None:
    a_user(conn, "rm3")
    store = PostgresReminders(conn)
    assert not store.daily_open("rm3", FAR)  # no set that day
    conn.execute(
        "insert into daily_challenge (day) values (%s) on conflict do nothing", (FAR,)
    )
    assert store.daily_open("rm3", FAR)
    conn.execute(
        "insert into quiz_attempt (user_id, daily_day, started_at, ends_at) "
        "values ('rm3', %s, now(), now() + interval '2 minutes')",
        (FAR,),
    )
    assert not store.daily_open("rm3", FAR)


def test_a_path_quiet_for_two_days_names_its_next_reading(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "rm4")
    source = _source(conn, "rmpath")
    _, first = _moment(conn, source, "one")
    _, second = _moment(conn, source, "two")
    _, swapped = _moment(conn, source, "swap")
    path = conn.execute(
        "insert into path (name, why, status, model, prompt_version) "
        "values ('Raft', 'why', 'live', 'm', 1) returning id"
    ).fetchone()
    assert path is not None
    section = conn.execute(
        "insert into path_section (path_id, ordinal) values (%s, 0) returning id",
        (path[0],),
    ).fetchone()
    assert section is not None
    conn.execute(
        "insert into path_session (section_id, ordinal, moment_id) "
        "values (%s, 0, %s), (%s, 1, %s)",
        (section[0], first, section[0], second),
    )
    conn.execute(
        "insert into user_path (user_id, path_id, status, started_at, updated_at) "
        "values ('rm4', %s, 'active', %s, %s)",
        (path[0], NOW - timedelta(days=5), NOW - timedelta(days=5)),
    )
    conn.execute(
        "insert into user_moment_finished (user_id, moment_id, method, finished_at) "
        "values ('rm4', %s, 'mark_done', %s)",
        (first, NOW - timedelta(days=1)),
    )
    store = PostgresReminders(conn)
    assert store.path_due("rm4", NOW) is None  # a reading yesterday
    later = NOW + timedelta(days=1, minutes=1)
    assert store.path_due("rm4", later) == PushNotice(
        "path_reminder", "Next on Raft", "Section two", f"/paths/{path[0]}"
    )
    # The user's own swap is what they'd read next.
    conn.execute(
        "insert into user_path_session (user_id, section_id, ordinal, moment_id) "
        "values ('rm4', %s, 1, %s)",
        (section[0], swapped),
    )
    due = store.path_due("rm4", later)
    assert due is not None and due.body == "Section swap"
    conn.execute("update user_path set status = 'paused' where user_id = 'rm4'")
    assert store.path_due("rm4", later) is None


def test_the_digest_counts_what_isnt_opened_or_finished(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "rm5")
    conn.execute(
        "insert into user_preferences (user_id, goals, topics, level, break_length) "
        "values ('rm5', '{stay-sharp}', '{backend}', 'beginner', '3-8')"
    )
    source = _source(conn, "rmfeed")
    items = [_moment(conn, source, n) for n in ("a", "b", "c")]
    for rank, (item, moment) in enumerate(items):
        conn.execute(
            "insert into user_feed_entry (user_id, chip, content_item_id, moment_id,"
            " rank, top_signal) values ('rm5', '3-8', %s, %s, %s, 'topic')",
            (item, moment, rank + 1),
        )
    store = PostgresReminders(conn)
    assert store.digest("rm5") == PushNotice(
        "digest", "Your break is ready", "3 new: Section a", "/"
    )
    conn.execute(
        "insert into user_moment_opened (user_id, moment_id) values ('rm5', %s)",
        (items[0][1],),
    )
    conn.execute(
        "insert into user_article_finished (user_id, content_item_id, method) "
        "values ('rm5', %s, 'mark_done')",
        (items[1][0],),
    )
    due = store.digest("rm5")
    assert due is not None and due.body == "New: Section c"


def test_one_claim_a_day(conn: psycopg.Connection) -> None:
    a_user(conn, "rm6")
    store = PostgresReminders(conn)
    day = date(2026, 11, 11)
    assert not store.sent_on("rm6", day)
    assert store.claim("rm6", day, "digest")
    assert not store.claim("rm6", day, "daily_challenge")
    assert store.sent_on("rm6", day)
    assert store.claim("rm6", day + timedelta(days=1), "digest")


def test_the_digest_never_names_a_broken_link_or_a_section_rights_no_longer_allow(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "rm7")
    conn.execute(
        "insert into user_preferences (user_id, goals, topics, level, break_length) "
        "values ('rm7', '{stay-sharp}', '{backend}', 'beginner', '3-8')"
    )
    source = _source(conn, "rmgate")
    broken_item, broken = _moment(conn, source, "broken")
    item, moment = _moment(conn, source, "ok")
    for rank, (i, m) in enumerate([(broken_item, broken), (item, moment)]):
        conn.execute(
            "insert into user_feed_entry (user_id, chip, content_item_id, moment_id,"
            " rank, top_signal) values ('rm7', '3-8', %s, %s, %s, 'topic')",
            (i, m, rank + 1),
        )
    conn.execute(
        "update content_item set link_broken_at = now() where id = %s", (broken_item,)
    )
    store = PostgresReminders(conn)
    assert store.digest("rm7") == PushNotice(
        "digest", "Your break is ready", "New: Section ok", "/"
    )
    # ING-2: the source no longer allows sections.
    conn.execute(
        "update source set moments_enabled = false, moments_switched_off = true "
        "where id = %s",
        (source,),
    )
    assert store.digest("rm7") is None


def test_a_path_reminder_follows_the_users_order_and_skips(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "rm8")
    source = _source(conn, "rmorder")
    _, a = _moment(conn, source, "first")
    _, b = _moment(conn, source, "second")
    path = conn.execute(
        "insert into path (name, why, status, model, prompt_version) "
        "values ('Order', 'why', 'live', 'm', 1) returning id"
    ).fetchone()
    assert path is not None
    sections: list[int] = []
    for ordinal, moment in enumerate((a, b)):
        row = conn.execute(
            "insert into path_section (path_id, ordinal) values (%s, %s) returning id",
            (path[0], ordinal),
        ).fetchone()
        assert row is not None
        sections.append(int(row[0]))
        conn.execute(
            "insert into path_session (section_id, ordinal, moment_id) "
            "values (%s, 0, %s)",
            (row[0], moment),
        )
    conn.execute(
        "insert into user_path (user_id, path_id, status, started_at, updated_at) "
        "values ('rm8', %s, 'active', %s, %s)",
        (path[0], NOW - timedelta(days=5), NOW - timedelta(days=5)),
    )
    store = PostgresReminders(conn)
    due = store.path_due("rm8", NOW)
    assert due is not None and due.body == "Section first"
    # The user moved the second section first: it's next.
    conn.execute(
        "insert into user_path_section (user_id, path_id, section_id, ordinal) "
        "values ('rm8', %s, %s, 1), ('rm8', %s, %s, 0)",
        (path[0], sections[0], path[0], sections[1]),
    )
    due = store.path_due("rm8", NOW)
    assert due is not None and due.body == "Section second"
    # Skipped: never named.
    conn.execute(
        "update user_path_section set skipped_at = now() "
        "where user_id = 'rm8' and section_id = %s",
        (sections[1],),
    )
    due = store.path_due("rm8", NOW)
    assert due is not None and due.body == "Section first"


def _path_of(
    conn: psycopg.Connection, user: str, moments: list[int]
) -> tuple[int, int]:
    """A live path of one section with these readings in order, active for the user and
    quiet for five days; returns (path id, section id)."""
    path = conn.execute(
        "insert into path (name, why, status, model, prompt_version) "
        "values ('Rights', 'why', 'live', 'm', 1) returning id"
    ).fetchone()
    assert path is not None
    section = conn.execute(
        "insert into path_section (path_id, ordinal) values (%s, 0) returning id",
        (path[0],),
    ).fetchone()
    assert section is not None
    for ordinal, moment in enumerate(moments):
        conn.execute(
            "insert into path_session (section_id, ordinal, moment_id) "
            "values (%s, %s, %s)",
            (section[0], ordinal, moment),
        )
    conn.execute(
        "insert into user_path (user_id, path_id, status, started_at, updated_at) "
        "values (%s, %s, 'active', %s, %s)",
        (user, path[0], NOW - timedelta(days=5), NOW - timedelta(days=5)),
    )
    return int(path[0]), int(section[0])


# ING-2 (drift audit 2026-11-11): a reminder names only what the web would show now.
def test_a_reading_its_rights_no_longer_allow_is_never_named(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "rm9")
    off = _source(conn, "rmoff")
    ok = _source(conn, "rmon")
    off_item, off_moment = _moment(conn, off, "off")
    dup_item, dup_moment = _moment(conn, ok, "dup")
    broken_item, broken_moment = _moment(conn, ok, "broken")
    _, kept = _moment(conn, ok, "kept")
    _path_of(conn, "rm9", [off_moment, dup_moment, broken_moment, kept])
    conn.execute(
        "update source set moments_enabled = false, moments_switched_off = true "
        "where id = %s",
        (off,),
    )
    conn.execute(
        "update content_item set duplicate_of = %s where id = %s",
        (off_item, dup_item),
    )
    conn.execute(
        "update content_item set link_broken_at = now() where id = %s", (broken_item,)
    )
    due = PostgresReminders(conn).path_due("rm9", NOW)
    assert due is not None and due.body == "Section kept"


def test_a_swap_counts_only_while_its_rights_allow_it(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "rm10")
    ok = _source(conn, "rmswapok")
    other = _source(conn, "rmswapdup")
    original, approved = _moment(conn, ok, "approved")
    swapped_item, swapped = _moment(conn, other, "swapped")
    _, section = _path_of(conn, "rm10", [approved])
    conn.execute(
        "insert into user_path_session (user_id, section_id, ordinal, moment_id) "
        "values ('rm10', %s, 0, %s)",
        (section, swapped),
    )
    store = PostgresReminders(conn)
    due = store.path_due("rm10", NOW)
    assert due is not None and due.body == "Section swapped"
    # The swap's item is found to be a duplicate (its moment stays, unlike a source
    # lowered, whose moments go): the approved reading comes back, as on the web.
    conn.execute(
        "update content_item set duplicate_of = %s where id = %s",
        (original, swapped_item),
    )
    due = store.path_due("rm10", NOW)
    assert due is not None and due.body == "Section approved"


def test_a_finish_counts_as_activity_even_once_its_rights_change(
    conn: psycopg.Connection,
) -> None:
    a_user(conn, "rm11")
    ok = _source(conn, "rmactive")
    done_item, done = _moment(conn, ok, "done")
    _, next_one = _moment(conn, ok, "next")
    _path_of(conn, "rm11", [done, next_one])
    conn.execute(
        "insert into user_moment_finished (user_id, moment_id, method, finished_at) "
        "values ('rm11', %s, 'mark_done', %s)",
        (done, NOW - timedelta(days=1)),
    )
    # Read yesterday; its item has since been found a duplicate of another: the reading
    # leaves the path, but it was still read yesterday.
    original, _ = _moment(conn, ok, "original")
    conn.execute(
        "update content_item set duplicate_of = %s where id = %s",
        (original, done_item),
    )
    assert PostgresReminders(conn).path_due("rm11", NOW) is None
