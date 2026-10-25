import psycopg
import pytest

from interval_db.generated import RightsProfile
from interval_jobs.sources import upsert_source


def item_for(conn: psycopg.Connection, profile: RightsProfile) -> int:
    source_id = upsert_source(
        conn,
        name=f"guard-{profile}",
        feed_url=f"https://guard.example.test/{profile}",
        rights_profile=profile,
        homepage=None,
    )
    row = conn.execute(
        "insert into content_item (source_id, guid, canonical_url, title) "
        "values (%s, 'g', 'https://guard.example.test/a', 't') returning id",
        (source_id,),
    ).fetchone()
    assert row is not None
    return row[0]


@pytest.mark.parametrize("profile", ["metadata_only", "excerpt"])
def test_database_refuses_full_text_the_profile_does_not_allow(
    conn: psycopg.Connection, profile: RightsProfile
) -> None:
    item_id = item_for(conn, profile)
    with pytest.raises(
        psycopg.errors.RaiseException, match="does not allow storing full text"
    ):
        conn.execute(
            "insert into content_item_private_text (content_item_id, text) "
            "values (%s, 'x')",
            (item_id,),
        )


def test_database_refuses_an_excerpt_for_metadata_only(
    conn: psycopg.Connection,
) -> None:
    item_id = item_for(conn, "metadata_only")
    with pytest.raises(
        psycopg.errors.RaiseException, match="does not allow storing an excerpt"
    ):
        conn.execute("update content_item set excerpt = 'x' where id = %s", (item_id,))


FULL_TEXT = "guard-full_text_internal"


def enable_moments(conn: psycopg.Connection, enabled: bool) -> None:
    conn.execute(
        "update source set moments_enabled = %s where name = %s", (enabled, FULL_TEXT)
    )


def add_moment(conn: psycopg.Connection, item_id: int) -> None:
    conn.execute(
        "insert into moment (content_item_id, ordinal, title, estimated_minutes, link, "
        "link_type) values (%s, 0, 't', 1, 'https://guard.example.test/a', 'page_top')",
        (item_id,),
    )


def moment_count(conn: psycopg.Connection, item_id: int) -> int:
    row = conn.execute(
        "select count(*) from moment where content_item_id = %s", (item_id,)
    ).fetchone()
    assert row is not None
    return row[0]


@pytest.mark.parametrize(
    ("profile", "moments_enabled"),
    [("full_text_internal", False), ("excerpt", True), ("metadata_only", True)],
)
def test_database_refuses_moments_without_the_switch_and_full_text_rights(
    conn: psycopg.Connection, profile: RightsProfile, moments_enabled: bool
) -> None:
    item_id = item_for(conn, profile)
    conn.execute(
        "update source set moments_enabled = %s where name = %s",
        (moments_enabled, f"guard-{profile}"),
    )
    with pytest.raises(psycopg.errors.RaiseException, match="does not allow moments"):
        add_moment(conn, item_id)


def test_switching_moments_off_deletes_them(conn: psycopg.Connection) -> None:
    item_id = item_for(conn, "full_text_internal")
    enable_moments(conn, True)
    add_moment(conn, item_id)
    enable_moments(conn, False)
    assert moment_count(conn, item_id) == 0


def test_lowering_the_profile_deletes_sections_and_moments(
    conn: psycopg.Connection,
) -> None:
    item_id = item_for(conn, "full_text_internal")
    enable_moments(conn, True)
    add_moment(conn, item_id)
    conn.execute(
        "insert into content_item_section (content_item_id, ordinal, heading, level, "
        "anchor_id, word_count) values (%s, 0, 'h', 2, null, 10)",
        (item_id,),
    )
    conn.execute(
        "update source set rights_profile = 'excerpt' where name = %s", (FULL_TEXT,)
    )
    assert moment_count(conn, item_id) == 0
    row = conn.execute(
        "select count(*) from content_item_section where content_item_id = %s",
        (item_id,),
    ).fetchone()
    assert row == (0,)


@pytest.mark.parametrize("profile", ["metadata_only", "excerpt"])
def test_database_refuses_sections_the_profile_does_not_allow(
    conn: psycopg.Connection, profile: RightsProfile
) -> None:
    item_id = item_for(conn, profile)
    with pytest.raises(
        psycopg.errors.RaiseException, match="does not allow storing full text"
    ):
        conn.execute(
            "insert into content_item_section "
            "(content_item_id, ordinal, heading, level, anchor_id, word_count) "
            "values (%s, 0, 'h', 2, null, 10)",
            (item_id,),
        )
