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
