"""ADR-0058 stage A: the expand migration copies every moment's rows to its article.

The backfill is tested on the real migration file: inside the test's rolled-back
transaction its down step runs, moment-era rows go in, and its up step runs again."""

import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

from interval_jobs.adapters.postgres import PostgresStore

Expanded = Callable[..., "Article"]
MIGRATION = (
    Path(__file__).parents[3]
    / "packages/db/migrations/20261127300000_articles_expand.sql"
)
TRIES = 10
DIMS = 1024


def _steps() -> tuple[str, str]:
    text = MIGRATION.read_text()
    up, down = text.split("-- migrate:down", 1)
    return up.split("-- migrate:up", 1)[1], down


def retrying(conn: psycopg.Connection, sql: str) -> None:
    # The DDL takes exclusive locks on tables the web suites read in the same database
    # (CI runs them together): a lock timeout under Postgres's 1 s deadlock check makes
    # this side give up first and try again, as reset_concepts does.
    for attempt in range(TRIES):
        try:
            with conn.transaction():
                conn.execute("set local lock_timeout = '500ms'")
                conn.execute(sql.encode())
                conn.execute("set local lock_timeout = 0")
            return
        except psycopg.errors.LockNotAvailable:
            if attempt == TRIES - 1:
                raise
            time.sleep(0.2 * (attempt + 1))


def _one(conn: psycopg.Connection, sql: str, params: tuple[object, ...] = ()) -> object:
    row = conn.execute(sql.encode(), params).fetchone()
    assert row is not None
    return row[0]


def row_id(conn: psycopg.Connection, sql: str, params: tuple[object, ...] = ()) -> int:
    value = _one(conn, sql, params)
    assert isinstance(value, int)
    return value


def _vector(*head: float) -> str:
    values = list(head) + [0.0] * (DIMS - len(head))
    return "[" + ",".join(str(v) for v in values) + "]"


class Article:
    def __init__(self, conn: psycopg.Connection, moments: int = 2) -> None:
        self.conn = conn
        tag = uuid4().hex[:8]
        name = f"expand-{tag}"
        PostgresStore(conn).sources.upsert(
            name=name,
            feed_url=f"https://expand.example.test/{tag}",
            rights_profile="full_text_internal",
            homepage=None,
        )
        conn.execute(
            "update source set moments_seeded = true, moments_enabled = true "
            "where name = %s",
            (name,),
        )
        self.id = row_id(
            conn,
            "insert into content_item (source_id, guid, canonical_url, title) "
            "select id, 'g', 'https://expand.example.test/a', 't' from source "
            "where name = %s returning id",
            (name,),
        )
        self.moments = [self.moment(ordinal) for ordinal in range(moments)]
        self.user = f"expand-{tag}"
        conn.execute(
            "insert into app_user (id, name, email) values (%s, 'n', %s)",
            (self.user, f"{self.user}@example.test"),
        )
        self.concept = row_id(
            conn,
            "insert into concept (slug, name, topic) "
            "values (%s, 'C', 'databases') returning id",
            (f"expand-{tag}",),
        )

    def moment(self, ordinal: int) -> int:
        return row_id(
            self.conn,
            "insert into moment (content_item_id, ordinal, title, "
            "estimated_minutes, link, link_type) values "
            "(%s, %s, 's', 1, 'https://expand.example.test/a', 'anchor') "
            "returning id",
            (self.id, ordinal),
        )

    def question(self, moment_id: int, ordinal: int, kind: str = "choice") -> int:
        shape = (
            "array['a','b','c','d'], 0, null, null"
            if kind == "choice"
            else "null, null, 10, 'ms'"
        )
        return row_id(
            self.conn,
            "insert into question (moment_id, ordinal, stem, citation, kind, "
            "options, correct, answer, unit, generator_model, prompt_version, "
            "content_hash) values (%s, %s, 'q?', 'c', %s::question_kind, "
            f"{shape}, 'm', 1, 'h') returning id",
            (moment_id, ordinal, kind),
        )

    def slots(self) -> dict[int, tuple[int | None, int | None]]:
        rows = self.conn.execute(
            "select q.id, q.content_item_id, q.article_ordinal from question q "
            "join moment m on m.id = q.moment_id where m.content_item_id = %s",
            (self.id,),
        ).fetchall()
        return {int(r[0]): (r[1], r[2]) for r in rows}


@pytest.fixture
def expanded(
    conn: psycopg.Connection,
) -> Expanded:
    """Runs the migration's down, lets the test add moment-era rows, then its up."""

    def run(before: Callable[[Article], None], moments: int = 2) -> Article:
        up, down = _steps()
        retrying(conn, down)
        article = Article(conn, moments)
        before(article)
        retrying(conn, up)
        return article

    return run


def test_questions_get_their_article_and_slots_in_moment_order(
    expanded: Expanded,
) -> None:
    ids: dict[str, int] = {}

    def before(a: Article) -> None:
        first, second = a.moments
        # Saved out of reading order: the slots follow the moments, not the ids.
        ids["second-0"] = a.question(second, 0)
        ids["first-1"] = a.question(first, 1)
        ids["first-0"] = a.question(first, 0)
        ids["estimate"] = a.question(second, 0, "estimate")

    a = expanded(before)
    assert a.slots() == {
        ids["first-0"]: (a.id, 0),
        ids["first-1"]: (a.id, 1),
        ids["second-0"]: (a.id, 2),
        ids["estimate"]: (a.id, 0),
    }
    # A question saved by moment only, as today's writers do, takes the next slot.
    later = a.question(a.moments[0], 2)
    assert a.slots()[later] == (a.id, 3)


def test_drafting_batch_and_path_rows_get_their_article(
    expanded: Expanded,
) -> None:
    def before(a: Article) -> None:
        moment = a.moments[1]
        question = a.question(moment, 0)
        a.conn.execute(
            "insert into question_drafting (moment_id, attempt, retry_at) "
            "values (%s, 1, now())",
            (moment,),
        )
        a.conn.execute(
            "insert into question_estimate_drafted (moment_id, content_hash) "
            "values (%s, 'h')",
            (moment,),
        )
        a.conn.execute(
            "insert into question_batch (id, kind, model) values (%s, 'draft', 'm')",
            (f"batch-{a.id}",),
        )
        a.conn.execute(
            "insert into question_batch_item (batch_id, custom_id, moment_id) "
            "values (%s, 'x', %s)",
            (f"batch-{a.id}", moment),
        )
        a.conn.execute(
            "insert into question_batch_item (batch_id, custom_id, question_id) "
            "values (%s, 'y', %s)",
            (f"batch-{a.id}", question),
        )

    a = expanded(before)
    for table in ("question_drafting", "question_estimate_drafted"):
        assert (
            _one(
                a.conn,
                f"select content_item_id from {table} where moment_id = %s",
                (a.moments[1],),
            )
            == a.id
        )
    rows = a.conn.execute(
        "select custom_id, content_item_id from question_batch_item "
        "where batch_id = %s order by custom_id",
        (f"batch-{a.id}",),
    ).fetchall()
    assert rows == [("x", a.id), ("y", a.id)]


def test_one_item_embedding_per_article_the_mean_of_its_moments(
    expanded: Expanded,
) -> None:
    def before(a: Article) -> None:
        for moment, head in zip(a.moments, [(1.0, 0.0), (0.0, 1.0)], strict=True):
            a.conn.execute(
                "insert into moment_embedding (moment_id, model, embedding) "
                "values (%s, 'e', %s::vector)",
                (moment, _vector(*head)),
            )
        a.conn.execute(
            "insert into item_embedding (content_item_id, model) values (%s, 'e')",
            (a.id,),
        )

    a = expanded(before)
    rows = a.conn.execute(
        "select model, embedding = %s::vector from item_embedding "
        "where content_item_id = %s",
        (_vector(0.5, 0.5), a.id),
    ).fetchall()
    assert rows == [("e", True)]
    # ING-2: the vector is of full text, so it goes when a purge takes the moments.
    a.conn.execute("delete from moment where content_item_id = %s", (a.id,))
    assert (
        _one(
            a.conn,
            "select embedding from item_embedding where content_item_id = %s",
            (a.id,),
        )
        is None
    )


def test_moment_answers_are_kept_per_article_beside_the_title_pass(
    expanded: Expanded,
) -> None:
    def before(a: Article) -> None:
        for moment, (difficulty, p) in zip(
            a.moments, [(0.0, 0.4), (2.0, 0.9)], strict=True
        ):
            a.conn.execute(
                "insert into moment_decision (moment_id, model, content_hash, "
                "difficulty) values (%s, 'm', 'h', %s)",
                (moment, difficulty),
            )
            a.conn.execute(
                "insert into moment_concept_probability "
                "(moment_id, model, concept_id, probability) values (%s, 'm', %s, %s)",
                (moment, a.concept, p),
            )
        a.conn.execute(
            "insert into item_decision (content_item_id, model, content_hash, "
            "difficulty) values (%s, 'm', 'title', 1.5)",
            (a.id,),
        )
        a.conn.execute(
            "insert into item_concept_probability "
            "(content_item_id, model, concept_id, probability) "
            "values (%s, 'm', %s, 0.6)",
            (a.id, a.concept),
        )

    a = expanded(before)
    decisions = a.conn.execute(
        "select model, content_hash = 'title', difficulty from item_decision "
        "where content_item_id = %s order by model",
        (a.id,),
    ).fetchall()
    assert decisions == [("m", True, 1.5), ("moments:m", False, 1.0)]
    probabilities = a.conn.execute(
        "select model, probability from item_concept_probability "
        "where content_item_id = %s order by model",
        (a.id,),
    ).fetchall()
    assert probabilities == [("m", 0.6), ("moments:m", 0.9)]


def test_the_moments_difficulty_is_their_median(expanded: Expanded) -> None:
    def before(a: Article) -> None:
        for moment, difficulty in zip(a.moments, [0.0, 2.0, 0.5], strict=True):
            a.conn.execute(
                "insert into moment_decision (moment_id, model, content_hash, "
                "difficulty) values (%s, 'm', 'h', %s)",
                (moment, difficulty),
            )

    a = expanded(before, 3)
    assert (
        _one(
            a.conn,
            "select difficulty from item_decision "
            "where content_item_id = %s and model = 'moments:m'",
            (a.id,),
        )
        == 0.5
    )


def test_opened_articles_start_at_the_first_open_or_finish(
    expanded: Expanded,
) -> None:
    finished = datetime(2026, 11, 1, tzinfo=UTC)
    opened = datetime(2026, 11, 2, tzinfo=UTC)

    def before(a: Article) -> None:
        a.conn.execute(
            "insert into user_moment_opened (user_id, moment_id, opened_at) "
            "values (%s, %s, %s)",
            (a.user, a.moments[1], opened),
        )
        a.conn.execute(
            "insert into user_moment_finished (user_id, moment_id, method, "
            "finished_at) values (%s, %s, 'mark_done', %s)",
            (a.user, a.moments[0], finished),
        )

    a = expanded(before)
    rows = a.conn.execute(
        "select content_item_id, opened_at from user_article_opened where user_id = %s",
        (a.user,),
    ).fetchall()
    assert rows == [(a.id, finished)]


def test_explainer_citations_name_the_article_and_down_undoes_it_all(
    expanded: Expanded,
) -> None:
    def before(a: Article) -> None:
        a.conn.execute(
            "insert into concept_explainer (concept_id, script, citations, "
            "generator_model, prompt_version) values (%s, 's', %s::jsonb, 'm', 1)",
            (
                a.concept,
                f'[{{"moment_id": {a.moments[0]}, "quote": "q"}}, '
                '{"moment_id": 0, "quote": "gone"}, 7]',
            ),
        )
        a.conn.execute(
            "insert into moment_decision (moment_id, model, content_hash, "
            "difficulty) values (%s, 'm', 'h', 1)",
            (a.moments[0],),
        )
        a.conn.execute(
            "insert into tag_override (content_item_id, heading, difficulty, "
            "concepts, updated_by) values (%s, 's', 'advanced', '{x}', 'owner')",
            (a.id,),
        )

    a = expanded(before)
    citations = "select citations from concept_explainer where concept_id = %s"
    assert _one(a.conn, citations, (a.concept,)) == [
        {"moment_id": a.moments[0], "quote": "q", "content_item_id": a.id},
        {"moment_id": 0, "quote": "gone"},
        7,
    ]
    # A section's override stays its own: today's readers apply only the '' row.
    overrides = a.conn.execute(
        "select heading from tag_override where content_item_id = %s", (a.id,)
    ).fetchall()
    assert overrides == [("s",)]

    retrying(a.conn, _steps()[1])
    assert _one(a.conn, citations, (a.concept,)) == [
        {"moment_id": a.moments[0], "quote": "q"},
        {"moment_id": 0, "quote": "gone"},
        7,
    ]
    assert (
        _one(
            a.conn,
            "select count(*) from item_decision where content_item_id = %s",
            (a.id,),
        )
        == 0
    )
    added = a.conn.execute(
        "select table_name, column_name from information_schema.columns "
        "where table_schema = 'public' and (table_name, column_name) in ("
        "('question', 'content_item_id'), ('question', 'article_ordinal'), "
        "('question_drafting', 'content_item_id'), "
        "('question_estimate_drafted', 'content_item_id'), "
        "('question_batch_item', 'content_item_id'), "
        "('path_session', 'content_item_id'), "
        "('user_path_session', 'content_item_id'), "
        "('item_embedding', 'embedding'))"
    ).fetchall()
    assert added == []
    assert _one(a.conn, "select to_regclass('user_article_opened')") is None


def test_rows_written_by_moment_until_stage_c_get_their_article(
    conn: psycopg.Connection,
) -> None:
    a = Article(conn)
    other = Article(conn)
    conn.execute(
        "insert into user_moment_opened (user_id, moment_id) values (%s, %s)",
        (a.user, a.moments[1]),
    )
    assert (
        row_id(
            conn,
            "select content_item_id from user_article_opened where user_id = %s",
            (a.user,),
        )
        == a.id
    )
    # A path swap rewrites the session's moment: its article follows.
    path = row_id(
        conn,
        "insert into path (name, why, model, prompt_version) "
        "values ('p', 'w', 'm', 1) returning id",
    )
    section = row_id(
        conn,
        "insert into path_section (path_id, ordinal) values (%s, 0) returning id",
        (path,),
    )
    conn.execute(
        "insert into path_session (section_id, ordinal, moment_id) values (%s, 0, %s)",
        (section, a.moments[0]),
    )
    conn.execute(
        "insert into user_path_session (user_id, section_id, ordinal, moment_id) "
        "values (%s, %s, 0, %s)",
        (a.user, section, a.moments[0]),
    )
    conn.execute(
        "update user_path_session set moment_id = %s where section_id = %s",
        (other.moments[0], section),
    )
    assert (
        row_id(
            conn,
            "select content_item_id from path_session where section_id = %s",
            (section,),
        )
        == a.id
    )
    assert (
        row_id(
            conn,
            "select content_item_id from user_path_session where section_id = %s",
            (section,),
        )
        == other.id
    )


def test_a_question_moved_or_changed_in_kind_takes_a_new_slot(
    conn: psycopg.Connection,
) -> None:
    a = Article(conn)
    other = Article(conn)
    moved = a.question(a.moments[0], 0)
    a.question(a.moments[0], 1)
    other.question(other.moments[0], 0)
    conn.execute(
        "update question set moment_id = %s where id = %s", (other.moments[1], moved)
    )
    slot = "select content_item_id, article_ordinal from question where id = %s"
    assert conn.execute(slot, (moved,)).fetchone() == (other.id, 1)
    other.question(other.moments[0], 0, "estimate")
    conn.execute(
        "update question set kind = 'estimate', options = null, correct = null, "
        "answer = 5, unit = 'ms' where id = %s",
        (moved,),
    )
    assert conn.execute(slot, (moved,)).fetchone() == (other.id, 1)
    kind = "select kind::text from question where id = %s"
    assert _one(conn, kind, (moved,)) == "estimate"
    # An update that moves nothing keeps the slot.
    conn.execute("update question set answer_count = 1 where id = %s", (moved,))
    assert conn.execute(slot, (moved,)).fetchone() == (other.id, 1)


def test_drafting_and_batch_rows_saved_by_moment_get_their_article(
    conn: psycopg.Connection,
) -> None:
    a = Article(conn)
    moment = a.moments[1]
    question = a.question(moment, 0)
    conn.execute(
        "insert into question_drafting (moment_id, attempt, retry_at) "
        "values (%s, 1, now())",
        (moment,),
    )
    conn.execute(
        "insert into question_estimate_drafted (moment_id, content_hash) "
        "values (%s, 'h')",
        (moment,),
    )
    batch = f"batch-{a.id}"
    conn.execute(
        "insert into question_batch (id, kind, model) values (%s, 'draft', 'm')",
        (batch,),
    )
    conn.execute(
        "insert into question_batch_item (batch_id, custom_id, moment_id) "
        "values (%s, 'x', %s)",
        (batch, moment),
    )
    conn.execute(
        "insert into question_batch_item (batch_id, custom_id, question_id) "
        "values (%s, 'y', %s)",
        (batch, question),
    )
    for table in ("question_drafting", "question_estimate_drafted"):
        assert (
            _one(
                conn,
                f"select content_item_id from {table} where moment_id = %s",
                (moment,),
            )
            == a.id
        )
    rows = conn.execute(
        "select custom_id, content_item_id from question_batch_item "
        "where batch_id = %s order by custom_id",
        (batch,),
    ).fetchall()
    assert rows == [("x", a.id), ("y", a.id)]


def test_a_finish_before_the_open_moves_the_articles_first_open_back(
    conn: psycopg.Connection,
) -> None:
    a = Article(conn)
    early = datetime(2026, 11, 1, tzinfo=UTC)
    late = datetime(2026, 11, 3, tzinfo=UTC)
    conn.execute(
        "insert into user_moment_opened (user_id, moment_id, opened_at) "
        "values (%s, %s, %s)",
        (a.user, a.moments[1], late),
    )
    conn.execute(
        "insert into user_moment_finished (user_id, moment_id, method, finished_at) "
        "values (%s, %s, 'mark_done', %s)",
        (a.user, a.moments[0], early),
    )
    first = "select opened_at from user_article_opened where user_id = %s"
    assert _one(conn, first, (a.user,)) == early
    conn.execute("delete from user_moment_opened where user_id = %s", (a.user,))
    conn.execute(
        "insert into user_moment_opened (user_id, moment_id, opened_at) "
        "values (%s, %s, %s)",
        (a.user, a.moments[1], late),
    )
    assert _one(conn, first, (a.user,)) == early


def test_the_article_vector_follows_moment_embedding_writes(
    conn: psycopg.Connection,
) -> None:
    # Stage A's triggers, as the moment-era worker wrote: moment vectors upserted, then
    # the item's completion mark (ADR-0058 stage B writes the article's vector itself).
    a = Article(conn)
    first, second = a.moments

    def embed(moment_id: int, model: str, *head: float) -> None:
        conn.execute(
            "insert into moment_embedding (moment_id, model, embedding) "
            "values (%s, %s, %s::vector) on conflict (moment_id) do update "
            "set model = excluded.model, embedding = excluded.embedding",
            (moment_id, model, _vector(*head)),
        )

    def complete(model: str) -> None:
        conn.execute(
            "insert into item_embedding (content_item_id, model) values (%s, %s) "
            "on conflict do nothing",
            (a.id, model),
        )

    def is_(model: str, *head: float) -> bool:
        return (
            _one(
                conn,
                "select embedding = %s::vector from item_embedding "
                "where content_item_id = %s and model = %s",
                (_vector(*head), a.id, model),
            )
            is True
        )

    rows = "select count(*) from item_embedding where content_item_id = %s"
    embed(first, "e", 1.0, 0.0)
    assert _one(conn, rows, (a.id,)) == 0  # no row until the item is embedded in full
    # The completion mark's insert fills the vector.
    embed(second, "e", 0.0, 1.0)
    complete("e")
    assert is_("e", 0.5, 0.5)
    # An upsert of a moment under the existing row recomputes it.
    embed(first, "e", 0.0, 1.0)
    assert is_("e", 0.0, 1.0)
    # A moment re-embedded by another model leaves this model's mean.
    embed(first, "f", 1.0, 0.0)
    complete("f")
    assert is_("e", 0.0, 1.0)
    assert is_("f", 1.0, 0.0)
