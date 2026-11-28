"""Concept explainers in Postgres (ING-2, AI-4, P4-W22-S01): what a script may be
written from (only full-text articles, live concepts, at least two articles; ADR-0058),
and each concept's script saved once, pending review, citing its articles."""

import psycopg

from interval_jobs.adapters.postgres import PostgresExplainers
from interval_jobs.ports import ExplainerCitation


def _source(conn: psycopg.Connection, name: str, profile: str) -> int:
    row = conn.execute(
        "insert into source (name, feed_url, rights_profile) values (%s, %s, %s) "
        "returning id",
        (f"src-{name}", f"https://{name}.test/feed", profile),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _article(conn: psycopg.Connection, source_id: int, title: str, concept: int) -> int:
    item = conn.execute(
        "insert into content_item (source_id, guid, canonical_url, title) "
        "values (%s, %s, %s, %s) returning id",
        (source_id, title, f"https://x.test/{title}", f"Article {title}"),
    ).fetchone()
    assert item is not None
    conn.execute(
        "insert into content_item_private_text (content_item_id, text) "
        "values (%s, 'Raft elects a leader.')",
        (item[0],),
    )
    conn.execute(
        "insert into item_tagging (content_item_id, difficulty, model, prompt_version) "
        "values (%s, 'beginner', 'm', 5)",
        (item[0],),
    )
    conn.execute(
        "insert into item_concept (content_item_id, concept_id) values (%s, %s)",
        (item[0], concept),
    )
    return int(item[0])


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
    a = _article(conn, full, "raft-a", raft)
    b = _article(conn, shown, "raft-b", raft)
    _article(conn, full, "one-a", one)
    _article(conn, full, "thin-a", thin)
    _article(conn, later, "thin-b", thin)
    _article(conn, full, "gone-a", gone)
    _article(conn, shown, "gone-b", gone)
    # A source cut back later keeps its articles, and is no source then (ING-2).
    conn.execute("update source set rights_profile = 'excerpt' where id = %s", (later,))
    store = PostgresExplainers(conn)
    ours = {raft, one, thin, gone}
    assert [t.concept_id for t in store.targets(1000) if t.concept_id in ours] == [raft]
    sources = store.sources(raft, 3)
    # The newest articles first.
    assert [s.item_id for s in sources] == sorted([a, b], reverse=True)
    assert {s.article_title for s in sources} == {"Article raft-a", "Article raft-b"}


def test_a_concept_is_written_once_and_then_no_target(conn: psycopg.Connection) -> None:
    full = _source(conn, "x-once", "full_text_internal")
    raft = _concept(conn, "explainer-once")
    a = _article(conn, full, "once-a", raft)
    _article(conn, full, "once-b", raft)
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
    # ADR-0058: a citation names its article.
    assert saved == [{"content_item_id": a, "quote": "candidates request votes"}]


def test_a_concept_tried_without_a_script_waits_and_broken_pages_are_no_source(
    conn: psycopg.Connection,
) -> None:
    full = _source(conn, "x-wait", "full_text_internal")
    tried = _concept(conn, "explainer-tried")
    _article(conn, full, "tried-a", tried)
    _article(conn, full, "tried-b", tried)
    broken = _concept(conn, "explainer-broken")
    _article(conn, full, "broken-a", broken)
    gone = _article(conn, full, "broken-b", broken)
    # ING-6: one of its two articles is gone from the web.
    conn.execute(
        "update content_item set link_broken_at = now() where id = %s",
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
