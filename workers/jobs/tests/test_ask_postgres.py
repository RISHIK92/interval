"""ADR-0046 in Postgres: a waiting question with its thread, level and stack; what
retrieval may return (never a hidden source, a broken link, a source switched off or a
duplicate; sources without full text through their concepts, by metadata); the answer
stored once; the 30-day purge."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg

from interval_jobs.adapters.postgres import PostgresAsk
from interval_jobs.ports import AskResult

NEAR = [1.0] + [0.0] * 1023
FAR = [0.0, 1.0] + [0.0] * 1022


def vec(values: list[float]) -> str:
    return "[" + ",".join(str(v) for v in values) + "]"


def user(conn: psycopg.Connection, user_id: str) -> None:
    conn.execute(
        "insert into app_user (id, name, email) values (%s, 'n', %s)",
        (user_id, f"{user_id}@x.test"),
    )


def source(
    conn: psycopg.Connection, name: str, profile: str, *, active: bool = True
) -> int:
    full = profile.startswith("full_text")
    row = conn.execute(
        "insert into source (name, feed_url, rights_profile, moments_enabled, "
        "moments_seeded, moments_switched_off, active) "
        "values (%s, %s, %s, %s, true, %s, %s) returning id",
        (f"ask-{name}", f"https://{name}.test/feed", profile, full, not full, active),
    ).fetchone()
    assert row is not None
    return int(row[0])


def item(
    conn: psycopg.Connection,
    source_id: int,
    slug: str,
    *,
    excerpt: str | None = None,
    broken: bool = False,
) -> int:
    row = conn.execute(
        "insert into content_item (source_id, guid, canonical_url, title, excerpt, "
        "link_broken_at) values (%s, %s, %s, %s, %s, "
        "case when %s then now() end) returning id",
        (source_id, slug, f"https://x.test/{slug}", f"Item {slug}", excerpt, broken),
    ).fetchone()
    assert row is not None
    return int(row[0])


def moment(
    conn: psycopg.Connection, item_id: int, title: str, vector: list[float]
) -> int:
    row = conn.execute(
        "insert into moment (content_item_id, ordinal, title, estimated_minutes, link, "
        "link_type) values (%s, 0, %s, 3, 'https://x.test/a#s', 'anchor') returning id",
        (item_id, title),
    ).fetchone()
    assert row is not None
    conn.execute(
        "insert into moment_embedding (moment_id, model, embedding) "
        "values (%s, 'ask-m', %s::vector)",
        (row[0], vec(vector)),
    )
    return int(row[0])


def test_retrieval_respects_hiding_links_switches_and_rights(
    conn: psycopg.Connection,
) -> None:
    user(conn, "ask-u1")
    full = source(conn, "full", "full_text_internal")
    hidden = source(conn, "hidden", "full_text_internal")
    off = source(conn, "off", "full_text_display", active=False)
    meta = source(conn, "meta", "metadata_only")
    excerpt = source(conn, "excerpt", "excerpt")
    conn.execute(
        "insert into user_hidden_source (user_id, source_id) values ('ask-u1', %s)",
        (hidden,),
    )
    kept = moment(conn, item(conn, full, "ask-a"), "Partitioning", NEAR)
    moment(conn, item(conn, full, "ask-broken", broken=True), "Broken", NEAR)
    moment(conn, item(conn, hidden, "ask-h"), "Hidden", NEAR)
    moment(conn, item(conn, off, "ask-off"), "Off", NEAR)
    concept = conn.execute(
        "insert into concept (slug, name, topic) values "
        "('ask-sharding', 'Sharding', 'databases') returning id"
    ).fetchone()
    assert concept is not None
    conn.execute(
        "insert into concept_embedding (concept_id, model, embedding, text_hash) "
        "values (%s, 'ask-m', %s::vector, 'h')",
        (concept[0], vec(NEAR)),
    )
    conn.execute(
        "insert into concept_explainer (concept_id, script, citations, "
        "generator_model, prompt_version, status, decided_at) values "
        "(%s, 'An approved script.', '[]', 'm', 1, 'approved', now())",
        (concept[0],),
    )
    meta_item = item(conn, meta, "ask-meta")
    excerpt_item = item(conn, excerpt, "ask-ex", excerpt="A short excerpt.")
    for tagged in (meta_item, excerpt_item):
        conn.execute(
            "insert into item_tagging (content_item_id, difficulty, model, "
            "prompt_version) values (%s, 'beginner', 'm', 1)",
            (tagged,),
        )
        conn.execute(
            "insert into item_concept (content_item_id, concept_id) values (%s, %s)",
            (tagged, concept[0]),
        )
    found = PostgresAsk(conn).nearest("ask-u1", NEAR, "ask-m", 8)
    by_id = {p.passage: p for p in found}
    assert f"m{kept}" in by_id
    assert {p.title for p in found if p.kind == "moment"} == {
        "Item ask-a: Partitioning"
    }
    assert by_id[f"m{kept}"].score > 0.99
    assert by_id[f"c{concept[0]}"].script == "An approved script."
    assert by_id[f"i{meta_item}"].excerpt is None
    assert by_id[f"i{meta_item}"].concept_names == ["Sharding"]
    assert by_id[f"i{excerpt_item}"].excerpt == "A short excerpt."
    # Another embedding model's vectors are someone else's space.
    assert PostgresAsk(conn).nearest("ask-u1", NEAR, "other", 8) == []


def ask(
    conn: psycopg.Connection,
    user_id: str,
    text: str,
    *,
    follow_up_of: str | None = None,
    chip: str | None = None,
    days_ago: int = 0,
) -> str:
    row = conn.execute(
        "insert into ask_question (user_id, text, chip, idempotency_key, "
        "follow_up_of, asked_at) values (%s, %s, %s, %s, %s::uuid, %s) returning id",
        (
            user_id,
            text,
            chip,
            f"k-{text}",
            follow_up_of,
            datetime.now(UTC) - timedelta(days=days_ago),
        ),
    ).fetchone()
    assert row is not None
    return str(row[0])


def test_a_waiting_question_its_thread_level_and_stack(
    conn: psycopg.Connection,
) -> None:
    user(conn, "ask-u2")
    conn.execute(
        "insert into user_preferences (user_id, goals, topics, level, break_length) "
        "values ('ask-u2', '{stay-sharp}', '{databases}', 'advanced', '3-8')"
    )
    tech = conn.execute(
        "insert into technology (slug, name, source) values "
        "('ask-pg', 'AskPostgres', 'seed') returning id"
    ).fetchone()
    assert tech is not None
    conn.execute(
        "insert into technology_package (technology_id, ecosystem, pattern, origin) "
        "values (%s, 'npm', 'ask-pg-driver', 'seed')",
        (tech[0],),
    )
    conn.execute(
        "insert into github_account (user_id, github_user_id, login) "
        "values ('ask-u2', 9123456789, 'asku2')"
    )
    conn.execute(
        "insert into github_repository (user_id, repo_id, installation_id, full_name, "
        "default_branch) values ('ask-u2', 1, 1, 'asku2/api', 'main')"
    )
    conn.execute(
        "insert into github_dependency (user_id, repo_id, ecosystem, name, path) "
        "values ('ask-u2', 1, 'npm', 'ask-pg-driver', 'package.json')"
    )
    store = PostgresAsk(conn)
    q1 = ask(conn, "ask-u2", "first")
    store.save(q1, AskResult("answered", "One.", [{"passage": "m1"}], "m", 1))
    q2 = ask(conn, "ask-u2", "second", follow_up_of=q1)
    q3 = ask(conn, "ask-u2", "third", follow_up_of=q2, chip="my_stack")
    request = store.to_answer(q3)
    assert request is not None
    assert (request.text, request.chip, request.level) == (
        "third",
        "my_stack",
        "advanced",
    )
    assert request.technologies == ["AskPostgres"]
    assert [(t.question, t.answer) for t in request.thread] == [
        ("first", "One."),
        ("second", None),
    ]
    assert store.to_answer(q1) is None  # answered


def test_the_answer_is_stored_once_and_questions_purge_after_30_days(
    conn: psycopg.Connection,
) -> None:
    user(conn, "ask-u3")
    store = PostgresAsk(conn)
    old = ask(conn, "ask-u3", "old", days_ago=31)
    new = ask(conn, "ask-u3", "new", days_ago=29)
    assert store.save(new, AskResult("nothing_found"))
    assert not store.save(new, AskResult("answered", "x", [], "m", 1))
    assert not store.save(str(UUID(int=7)), AskResult("unavailable"))
    row = conn.execute(
        "select outcome, text from ask_answer where question_id = %s", (new,)
    ).fetchone()
    assert row == ("nothing_found", None)
    assert store.purge(datetime.now(UTC) - timedelta(days=30)) == 1
    left = conn.execute(
        "select id::text from ask_question where user_id = 'ask-u3'"
    ).fetchall()
    assert left == [(new,)] and old != new
