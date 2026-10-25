import httpx
import psycopg
import pytest

from interval_db.generated import RightsProfile
from interval_jobs.ingest.one import ingest_one
from interval_jobs.segment import SectionRow, plan_moments, segment_item
from interval_jobs.sources import upsert_source

from .conftest import fixture_bytes

FEED_URL = "https://seg.example.test/feed.atom"
ARTICLE_URL = "https://blog.example.test/wal"


def public(_host: str) -> list[str]:
    return ["93.184.216.34"]


def web(article: str) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == FEED_URL:
            return httpx.Response(
                200,
                headers={"content-type": "application/atom+xml"},
                content=fixture_bytes("atom.xml"),
            )
        return httpx.Response(
            200, headers={"content-type": "text/html"}, content=fixture_bytes(article)
        )

    return httpx.Client(transport=httpx.MockTransport(handler))


def ingest(
    conn: psycopg.Connection,
    article: str,
    profile: RightsProfile = "full_text_internal",
    moments_enabled: bool = True,
) -> tuple[int, int]:
    source_id = upsert_source(
        conn, name="seg-test", feed_url=FEED_URL, rights_profile=profile, homepage=None
    )
    conn.execute(
        "update source set moments_enabled = %s where id = %s",
        (moments_enabled, source_id),
    )
    with web(article) as http:
        item_id = ingest_one(conn, http, source_id, public).content_item_id
    return source_id, item_id


def moments(
    conn: psycopg.Connection, item_id: int
) -> list[tuple[int, str, int, str, str]]:
    return conn.execute(
        "select ordinal, title, estimated_minutes, link, link_type::text from moment "
        "where content_item_id = %s order by ordinal",
        (item_id,),
    ).fetchall()


def test_headings_with_ids_become_anchor_moments_after_a_page_top_intro(
    conn: psycopg.Connection,
) -> None:
    _, item_id = ingest(conn, "article_mixed.html")
    segment_item(conn, item_id)
    got = moments(conn, item_id)

    assert [m[0] for m in got] == list(range(len(got)))
    assert got[0][1:] == ("How our write-ahead log works", 1, ARTICLE_URL, "page_top")
    by_title = {m[1]: m for m in got[1:]}
    assert by_title["Setup"][3:] == (f"{ARTICLE_URL}#setup", "anchor")
    assert by_title["Log shipping"][3:] == (f"{ARTICLE_URL}#log-shipping", "anchor")
    assert by_title["Plain heading"][3:] == (
        f"{ARTICLE_URL}#:~:text=Plain%20heading",
        "text_fragment",
    )
    # 68 prose words + 180 code tokens = 248 words -> ceil(248 / 230) = 2 minutes.
    assert by_title["Log shipping"][2] == 2


def test_headings_without_ids_get_encoded_text_fragment_links(
    conn: psycopg.Connection,
) -> None:
    _, item_id = ingest(conn, "article_no_ids.html")
    segment_item(conn, item_id)
    links = {m[1]: (m[3], m[4]) for m in moments(conn, item_id)}

    assert links["Leaders & followers"] == (
        f"{ARTICLE_URL}#:~:text=Leaders%20%26%20followers",
        "text_fragment",
    )
    assert links["Quorum, reads-writes"] == (
        f"{ARTICLE_URL}#:~:text=Quorum%2C%20reads%2Dwrites",
        "text_fragment",
    )


def test_minutes_round_up_with_a_minimum_of_one(conn: psycopg.Connection) -> None:
    _, item_id = ingest(conn, "article_no_ids.html")
    segment_item(conn, item_id)
    minutes = {m[1]: m[2] for m in moments(conn, item_id)}

    assert minutes["Leaders & followers"] == 2  # 25 x 17 = 425 words -> ceil(425 / 230)
    assert minutes["Quorum, reads-writes"] == 1  # 6 x 17 = 102 words, below one minute


def test_article_without_headings_gets_no_moments(conn: psycopg.Connection) -> None:
    _, item_id = ingest(conn, "article_no_headings.html")
    segment_item(conn, item_id)
    assert moments(conn, item_id) == []


def test_moments_switched_off_creates_none_and_removes_existing(
    conn: psycopg.Connection,
) -> None:
    source_id, item_id = ingest(conn, "article.html")
    segment_item(conn, item_id)
    assert moments(conn, item_id) != []

    conn.execute(
        "update source set moments_enabled = false where id = %s", (source_id,)
    )
    segment_item(conn, item_id)
    assert moments(conn, item_id) == []


@pytest.mark.parametrize("profile", ["metadata_only", "excerpt"])
def test_sources_without_internal_full_text_get_no_moments(
    conn: psycopg.Connection, profile: RightsProfile
) -> None:
    _, item_id = ingest(conn, "article.html", profile=profile)
    assert segment_item(conn, item_id) == []
    assert moments(conn, item_id) == []


def ids(conn: psycopg.Connection, item_id: int) -> list[int]:
    return [
        r[0]
        for r in conn.execute(
            "select id from moment where content_item_id = %s order by ordinal",
            (item_id,),
        ).fetchall()
    ]


def test_running_twice_gives_the_same_moments_with_the_same_ids(
    conn: psycopg.Connection,
) -> None:
    _, item_id = ingest(conn, "article_mixed.html")
    first, first_ids = moments(conn, item_id), ids(conn, item_id)
    segment_item(conn, item_id)
    assert moments(conn, item_id) == first
    assert ids(conn, item_id) == first_ids


def test_ingest_segments_and_reingest_with_new_html_replaces_the_moments(
    conn: psycopg.Connection,
) -> None:
    _, item_id = ingest(conn, "article_mixed.html")
    assert len(moments(conn, item_id)) > 2

    _, again = ingest(conn, "article_v2.html")
    assert again == item_id
    assert [m[1] for m in moments(conn, item_id)] == [
        "How our write-ahead log works",
        "Only section",
    ]

    _, again = ingest(conn, "article_no_headings.html")
    assert moments(conn, item_id) == []


def test_headings_without_content_give_no_moments() -> None:
    sections = [SectionRow(heading=None, anchor_id=None, word_count=300)]
    sections.append(SectionRow(heading="Empty", anchor_id="e", word_count=0))
    assert plan_moments("T", "https://a.example.test/p", sections) == []
