"""Concept explainers in Postgres (ING-2, AI-4, P4-W22-S01): what a script may be
written from (only full-text sources with moments on, live concepts, at least two
articles), and each concept's script saved once, pending review."""

import psycopg

from interval_jobs.adapters.postgres import PostgresExplainers
from interval_jobs.ports import ExplainerCitation


def _source(
    conn: psycopg.Connection, name: str, profile: str, moments: bool = True
) -> int:
    row = conn.execute(
        "insert into source (name, feed_url, rights_profile, moments_enabled, "
        "moments_seeded, moments_switched_off) values (%s, %s, %s, %s, true, %s) "
        "returning id",
        (f"src-{name}", f"https://{name}.test/feed", profile, moments, not moments),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _moment(conn: psycopg.Connection, source_id: int, title: str, concept: int) -> int:
    item = conn.execute(
        "insert into content_item (source_id, guid, canonical_url, title) "
        "values (%s, %s, %s, %s) returning id",
        (source_id, title, f"https://x.test/{title}", f"Article {title}"),
    ).fetchone()
    assert item is not None
    moment = conn.execute(
        "insert into moment (content_item_id, ordinal, title, estimated_minutes, link, "
        "link_type) values (%s, 0, %s, 3, %s, 'anchor') returning id",
        (item[0], f"Section {title}", f"https://x.test/{title}#s"),
    ).fetchone()
    assert moment is not None
    conn.execute(
        "insert into moment_tagging (moment_id, difficulty) values (%s, 'beginner')",
        (moment[0],),
    )
    conn.execute(
        "insert into moment_concept (moment_id, concept_id) values (%s, %s)",
        (moment[0], concept),
    )
    return int(moment[0])


def _concept(conn: psycopg.Connection, slug: str, retired: bool = False) -> int:
    row = conn.execute(
        "insert into concept (slug, name, topic, retired_at) values "
        "(%s, %s, 'distributed-systems', case when %s then now() end) returning id",
        (slug, slug.title(), retired),
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_only_full_text_sources_and_live_concepts_in_two_articles(
    conn: psycopg.Connection,
) -> None:
    full = _source(conn, "x-full", "full_text_internal")
    shown = _source(conn, "x-shown", "full_text_display")
    later = _source(conn, "x-later", "full_text_internal")
    raft = _concept(conn, "explainer-raft")
    one = _concept(conn, "explainer-one-article")
    thin = _concept(conn, "explainer-thin-rights")
    gone = _concept(conn, "explainer-retired", retired=True)
    a = _moment(conn, full, "raft-a", raft)
    b = _moment(conn, shown, "raft-b", raft)
    _moment(conn, full, "one-a", one)
    _moment(conn, full, "thin-a", thin)
    _moment(conn, later, "thin-b", thin)
    _moment(conn, full, "gone-a", gone)
    _moment(conn, shown, "gone-b", gone)
    # The database refuses moments under other rights; a source cut back later keeps
    # its rows, and is no source then (ING-2).
    conn.execute(
        "update source set rights_profile = 'excerpt', moments_enabled = false, "
        "moments_switched_off = true where id = %s",
        (later,),
    )
    store = PostgresExplainers(conn)
    ours = {raft, one, thin, gone}
    assert [t.concept_id for t in store.targets(1000) if t.concept_id in ours] == [raft]
    sources = store.sources(raft, 3)
    assert sorted(s.moment_id for s in sources) == sorted([a, b])
    assert {s.section_title for s in sources} == {"Section raft-a", "Section raft-b"}


def test_a_concept_is_written_once_and_then_no_target(conn: psycopg.Connection) -> None:
    full = _source(conn, "x-once", "full_text_internal")
    raft = _concept(conn, "explainer-once")
    a = _moment(conn, full, "once-a", raft)
    _moment(conn, full, "once-b", raft)
    store = PostgresExplainers(conn)
    citations = [ExplainerCitation(a, "candidates request votes")]
    assert store.save(raft, "A script.", citations, "qwen/x", 1)
    assert not store.save(raft, "Another.", citations, "qwen/x", 1)
    assert raft not in {t.concept_id for t in store.targets(1000)}
    status, saved = conn.execute(
        "select status::text, citations from concept_explainer where concept_id = %s",
        (raft,),
    ).fetchone() or (None, None)
    assert status == "pending"
    assert saved == [{"moment_id": a, "quote": "candidates request votes"}]


def test_a_concept_tried_without_a_script_waits_and_broken_pages_are_no_source(
    conn: psycopg.Connection,
) -> None:
    full = _source(conn, "x-wait", "full_text_internal")
    tried = _concept(conn, "explainer-tried")
    _moment(conn, full, "tried-a", tried)
    _moment(conn, full, "tried-b", tried)
    broken = _concept(conn, "explainer-broken")
    _moment(conn, full, "broken-a", broken)
    gone = _moment(conn, full, "broken-b", broken)
    # ING-6: one of its two articles is gone from the web.
    conn.execute(
        "update content_item set link_broken_at = now() "
        "where id = (select content_item_id from moment where id = %s)",
        (gone,),
    )
    store = PostgresExplainers(conn)
    ours = {tried, broken}
    assert [t.concept_id for t in store.targets(1000) if t.concept_id in ours] == [
        tried
    ]
    store.tried(tried, "refused")
    assert tried not in {t.concept_id for t in store.targets(1000)}
    # A week on, it is tried again.
    conn.execute(
        "update concept_explainer_attempt set tried_at = now() - interval '8 days' "
        "where concept_id = %s",
        (tried,),
    )
    assert tried in {t.concept_id for t in store.targets(1000)}
