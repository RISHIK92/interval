"""Scene timelines in Postgres (TTS-5, P4.5-W26-S01): which explainers to draw
(approved, voiced, captioned, none yet, not refused lately),
each saved once, pending."""

import json

import psycopg
import pytest

from interval_jobs.adapters.postgres import PostgresScenes


def _explainer(
    conn: psycopg.Connection,
    slug: str,
    status: str = "approved",
    voiced: bool = True,
    captions: bool = True,
) -> int:
    concept = conn.execute(
        "insert into concept (slug, name, topic) values (%s, %s, 'databases') "
        "returning id",
        (slug, slug.title()),
    ).fetchone()
    assert concept is not None
    explainer = conn.execute(
        "insert into concept_explainer (concept_id, script, citations, "
        "generator_model, prompt_version, status, decided_at) values "
        "(%s, 'A script.', '[]', 'm', 1, %s, case when %s = 'pending' then null "
        "else now() end) returning id",
        (concept[0], status, status),
    ).fetchone()
    assert explainer is not None
    if voiced:
        conn.execute(
            "insert into explainer_audio (explainer_id, provider, voice, playlist_key, "
            "duration_seconds, words, captions) values (%s, 'polly', 'v', %s, 10, "
            "'[]', %s)",
            (
                explainer[0],
                f"media/explainers/{concept[0]}/{explainer[0]}/r/index.m3u8",
                json.dumps(
                    [
                        {"text": "A", "start": 0, "end": 0.4},
                        {"text": "script.", "start": 0.4, "end": 1},
                    ]
                    if captions
                    else []
                ),
            ),
        )
    return int(explainer[0])


def test_targets_are_approved_voiced_explainers_with_no_timeline(
    conn: psycopg.Connection,
) -> None:
    drawn = _explainer(conn, "sc-drawn")
    ready = _explainer(conn, "sc-ready")
    _explainer(conn, "sc-pending", status="pending")
    _explainer(conn, "sc-rejected", status="rejected")
    _explainer(conn, "sc-silent", voiced=False)
    _explainer(conn, "sc-uncaptioned", captions=False)
    store = PostgresScenes(conn)
    assert store.save(drawn, f"media/explainers/1/{drawn}/scenes/a.json", "m", 1)
    mine = [t for t in store.targets(1000) if t.concept.startswith("Sc-")]
    assert [(t.explainer_id, t.captions) for t in mine] == [(ready, ["A", "script."])]
    # Refused lately: left alone.
    store.tried(ready)
    assert not [t for t in store.targets(1000) if t.explainer_id == ready]
    # A week on, it is drawn again.
    conn.execute(
        "update explainer_scene_attempt set tried_at = now() - interval '8 days' "
        "where explainer_id = %s",
        (ready,),
    )
    assert [t for t in store.targets(1000) if t.explainer_id == ready]


def test_a_timeline_is_saved_once_pending(conn: psycopg.Connection) -> None:
    x = _explainer(conn, "sc-once")
    store = PostgresScenes(conn)
    key = f"media/explainers/1/{x}/scenes/a.json"
    assert store.save(x, key, "m", 1)
    assert not store.save(x, key, "m", 1)
    row = conn.execute(
        "select status, scene_key, decided_at from explainer_scene "
        "where explainer_id = %s",
        (x,),
    ).fetchone()
    assert row == ("pending", key, None)
    # Only a JSON file under the explainers' media path.
    bad = _explainer(conn, "sc-bad")
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        conn.execute(
            "insert into explainer_scene (explainer_id, scene_key, generator_model, "
            "prompt_version) values (%s, 'elsewhere.txt', 'm', 1)",
            (bad,),
        )
    # Decided means a decision time; pending means none.
    undated = _explainer(conn, "sc-undated")
    with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
        conn.execute(
            "insert into explainer_scene (explainer_id, scene_key, generator_model, "
            "prompt_version, status) values (%s, %s, 'm', 1, 'approved')",
            (undated, "media/explainers/1/1/scenes/b.json"),
        )
