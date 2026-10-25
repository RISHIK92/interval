"""Week 1 vertical path: feed -> ingest -> moments -> precomputed feed -> card rows."""

import psycopg

from .support import ARTICLE_URL, ingest


def test_one_feed_becomes_moment_cards_without_source_text(
    conn: psycopg.Connection,
) -> None:
    ingest(conn, "article_mixed.html")

    cards = conn.execute(
        """
        select section_title, section_number, section_count, estimated_minutes, link,
               article_title, author, source_name
        from feed_visible where source_name = 'seg-test' order by rank
        """
    ).fetchall()

    assert [c[0] for c in cards] == [
        "How our write-ahead log works",
        "Setup",
        "Log shipping",
        "Plain heading",
        "Notes",
        "Notes",
    ]
    total = len(cards)
    assert [(c[1], c[2]) for c in cards] == [(n, total) for n in range(1, total + 1)]
    setup = cards[1]
    assert setup[3:] == (
        1,
        f"{ARTICLE_URL}#setup",
        "How our write-ahead log works",
        "Alex Author",
        "seg-test",
    )
    columns = {
        row[0]
        for row in conn.execute(
            "select column_name from information_schema.columns "
            "where table_name = 'feed_visible'"
        ).fetchall()
    }
    # An allowlist: any new column (e.g. a summary) must be added here on purpose.
    assert columns == {
        "rank",
        "moment_id",
        "section_title",
        "section_number",
        "section_count",
        "estimated_minutes",
        "link",
        "article_title",
        "author",
        "source_name",
    }
