"""ADR-0058 stage C: the contract migration folds every moment's rows into its article
before it drops the moment schema, so no model output or person's data is lost.

Its down step can't restore the moments, so it is tested on its own database: migrated
to just before it (stage B, the moment-era schema), seeded per test in a rolled-back
transaction, then the migration's up step run on the seed."""

import os
import subprocess
from collections.abc import Callable, Iterator
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest

MIGRATIONS = Path(__file__).parents[3] / "packages/db/migrations"
MIGRATION = MIGRATIONS / "20261128000000_articles_contract.sql"
DIMS = 1024


def _steps() -> tuple[str, str]:
    text = MIGRATION.read_text()
    up, down = text.split("-- migrate:down", 1)
    return up.split("-- migrate:up", 1)[1], down


def _with_database(url: str, name: str) -> str:
    base, _, query = url.partition("?")
    return f"{base.rsplit('/', 1)[0]}/{name}" + (f"?{query}" if query else "")


@pytest.fixture(scope="module")
def before_contract(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    """A database migrated up to, not including, the contract step."""
    url = os.environ.get("DATABASE_URL")
    assert url, "DATABASE_URL is not set; copy .env.example to .env"
    name = f"interval_contract_{os.getpid()}"
    scratch = _with_database(url, name)
    folder = tmp_path_factory.mktemp("migrations")
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name < MIGRATION.name:
            (folder / path.name).symlink_to(path)
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(f'drop database if exists "{name}"'.encode())
        admin.execute(f'create database "{name}"'.encode())
    try:
        subprocess.run(
            [
                "dbmate",
                "--url",
                scratch,
                "--migrations-dir",
                str(folder),
                "--no-dump-schema",
                "up",
            ],
            check=True,
            capture_output=True,
        )
        yield scratch
    finally:
        with psycopg.connect(url, autocommit=True) as admin:
            admin.execute(f'drop database if exists "{name}" with (force)'.encode())


@pytest.fixture
def db(before_contract: str) -> Iterator[psycopg.Connection]:
    with (
        psycopg.connect(before_contract) as connection,
        connection.transaction(force_rollback=True),
    ):
        yield connection


def _one(conn: psycopg.Connection, sql: str, params: tuple[object, ...] = ()) -> object:
    row = conn.execute(sql.encode(), params).fetchone()
    assert row is not None
    return row[0]


def _id(conn: psycopg.Connection, sql: str, params: tuple[object, ...] = ()) -> int:
    value = _one(conn, sql, params)
    assert isinstance(value, int)
    return value


def _rows(
    conn: psycopg.Connection, sql: str, params: tuple[object, ...] = ()
) -> list[tuple[object, ...]]:
    return [tuple(r) for r in conn.execute(sql.encode(), params).fetchall()]


def _vector(*head: float) -> str:
    return "[" + ",".join(str(v) for v in [*head, *[0.0] * (DIMS - len(head))]) + "]"


class Article:
    """A full-text article with moments, a reader and concepts, as stage B left them."""

    def __init__(self, conn: psycopg.Connection, moments: int = 2) -> None:
        self.conn = conn
        tag = uuid4().hex[:8]
        self.source = _id(
            conn,
            "insert into source (name, feed_url, rights_profile, moments_seeded, "
            "moments_enabled) values (%s, %s, 'full_text_internal', true, true) "
            "returning id",
            (f"contract-{tag}", f"https://contract.example.test/{tag}"),
        )
        self.id = _id(
            conn,
            "insert into content_item (source_id, guid, canonical_url, title) "
            "values (%s, 'g', %s, 't') returning id",
            (self.source, f"https://contract.example.test/{tag}/a"),
        )
        self.moments = [
            _id(
                conn,
                "insert into moment (content_item_id, ordinal, title, "
                "estimated_minutes, link, link_type) values (%s, %s, %s, 1, "
                "'https://contract.example.test/a', 'anchor') returning id",
                (self.id, ordinal, f"Section {ordinal}"),
            )
            for ordinal in range(moments)
        ]
        self.user = f"contract-{tag}"
        conn.execute(
            "insert into app_user (id, name, email) values (%s, 'n', %s)",
            (self.user, f"{self.user}@example.test"),
        )
        self.concepts = [
            _id(
                conn,
                "insert into concept (slug, name, topic) "
                "values (%s, 'C', 'databases') returning id",
                (f"contract-{tag}-{n}",),
            )
            for n in range(7)
        ]

    def question(self, moment_id: int, ordinal: int, kind: str = "choice") -> int:
        shape = (
            "array['a','b','c','d'], 0, null, null"
            if kind == "choice"
            else "null, null, 10, 'ms'"
        )
        return _id(
            self.conn,
            "insert into question (moment_id, ordinal, stem, citation, kind, "
            "options, correct, answer, unit, generator_model, prompt_version, "
            "content_hash, status) values (%s, %s, 'q?', 'c', %s::question_kind, "
            f"{shape}, 'm', 1, 'h', 'live') returning id",
            (moment_id, ordinal, kind),
        )


Contracted = Callable[[Callable[[Article], None]], Article]


@pytest.fixture
def contracted(db: psycopg.Connection) -> Contracted:
    def run(before: Callable[[Article], None]) -> Article:
        article = Article(db)
        before(article)
        db.execute(_steps()[0].encode())
        return article

    return run


def test_the_down_step_refuses(db: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.RaiseException, match="cannot be undone"):
        db.execute(_steps()[1].encode())


def test_the_moment_schema_and_the_chips_are_gone(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    contracted(lambda a: None)
    tables = _rows(
        db,
        "select table_name from information_schema.tables "
        "where table_schema = 'public' and table_name like '%%moment%%'",
    )
    assert tables == []
    columns = _rows(
        db,
        "select table_name, column_name from information_schema.columns "
        "where table_schema = 'public' and (column_name in "
        "('moment_id', 'chip', 'break_length', 'section_title', 'heading') "
        "or column_name like 'moments%%') "
        "and table_name not in ('ask_question', 'content_item_section')",
    )
    assert columns == []
    assert _rows(db, "select 1 from pg_type where typname = 'break_length'") == []
    assert _rows(db, "select 1 from ranking_config where key = 'weight.time_fit'") == []


def test_moment_answers_are_kept_under_their_own_keys_marked_full_text(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    def before(a: Article) -> None:
        c0, c1, c2 = a.concepts[:3]
        # The article's own title pass: c0 at 0.6, c1 at 0.5.
        db.execute(
            "insert into item_decision (content_item_id, model, content_hash, "
            "difficulty) values (%s, 'm', 'title', 1.5)",
            (a.id,),
        )
        db.execute(
            "insert into item_concept_probability (content_item_id, model, "
            "concept_id, probability) values (%s, 'm', %s, 0.6), (%s, 'm', %s, 0.5)",
            (a.id, c0, a.id, c1),
        )
        # Stage A's copy, stale: its moments were decided again since.
        db.execute(
            "insert into item_decision (content_item_id, model, content_hash, "
            "difficulty) values (%s, 'moments:m', 'stale', 0.1)",
            (a.id,),
        )
        # Its moments, decided by m.
        for moment, (p0, p2) in zip(a.moments, [(0.9, 0.3), (0.2, 0.7)], strict=True):
            db.execute(
                "insert into moment_decision (moment_id, model, content_hash, "
                "difficulty) values (%s, 'm', 'h', 1.0)",
                (moment,),
            )
            db.execute(
                "insert into moment_concept_probability (moment_id, model, "
                "concept_id, probability) values (%s, 'm', %s, %s), "
                "(%s, 'm', %s, %s)",
                (moment, c0, p0, moment, c2, p2),
            )

    a = contracted(before)
    c0, c1, c2 = a.concepts[:3]
    decisions = _rows(
        db,
        "select model, content_hash = 'title', difficulty, from_full_text "
        "from item_decision where content_item_id = %s order by model",
        (a.id,),
    )
    # The title pass is untouched; the moments' answers are their own rows, each
    # moment's and stage A's per-article copy (refreshed), all read off full text.
    assert decisions == [
        ("m", True, 1.5, False),
        ("moments:m", False, 1.0, True),
        ("moments:m:0", False, 1.0, True),
        ("moments:m:1", False, 1.0, True),
    ]
    assert _one(
        db,
        "select content_hash <> 'stale' from item_decision "
        "where content_item_id = %s and model = 'moments:m'",
        (a.id,),
    )
    probabilities = _rows(
        db,
        "select model, concept_id, probability from item_concept_probability "
        "where content_item_id = %s order by model, concept_id",
        (a.id,),
    )
    assert probabilities == [
        ("m", c0, 0.6),
        ("m", c1, 0.5),
        ("moments:m", c0, 0.9),
        ("moments:m", c2, 0.7),
        ("moments:m:0", c0, 0.9),
        ("moments:m:0", c2, 0.3),
        ("moments:m:1", c0, 0.2),
        ("moments:m:1", c2, 0.7),
    ]
    # Moment tags with answers behind them aren't kept again as 'moments:tags'.
    assert (
        _one(
            db,
            "select count(*) from item_decision "
            "where content_item_id = %s and model = 'moments:tags'",
            (a.id,),
        )
        == 0
    )


def test_moment_tags_are_kept_as_answers_and_an_untagged_article_gets_them(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    tagged: list[int] = []

    def before(a: Article) -> None:
        for n, moment in enumerate(a.moments):
            db.execute(
                "insert into moment_tagging (moment_id, difficulty) values "
                "(%s, %s::difficulty)",
                (moment, "advanced" if n else "intermediate"),
            )
        # The highest-id concept on both moments, the six others on one: five are
        # kept, the shared one first by its count, though its id is the highest.
        shared = a.concepts[-1]
        db.execute(
            "insert into moment_concept (moment_id, concept_id) "
            "select %s, unnest(%s::bigint[])",
            (a.moments[0], a.concepts),
        )
        db.execute(
            "insert into moment_concept (moment_id, concept_id) values (%s, %s)",
            (a.moments[1], shared),
        )
        # An article tagged whole already, with moment tags beside.
        b = Article(db, moments=1)
        tagged.append(b.id)
        db.execute(
            "insert into item_tagging (content_item_id, difficulty, model, "
            "prompt_version) values (%s, 'beginner', 'm', 5)",
            (b.id,),
        )
        db.execute(
            "insert into moment_tagging (moment_id, difficulty) "
            "values (%s, 'advanced')",
            (b.moments[0],),
        )
        db.execute(
            "insert into moment_concept (moment_id, concept_id) values (%s, %s)",
            (b.moments[0], b.concepts[0]),
        )

    a = contracted(before)
    assert _rows(
        db,
        "select difficulty::text, model, from_full_text from item_tagging "
        "where content_item_id = %s",
        (a.id,),
    ) == [("intermediate", "moments", True)]
    concepts = [
        int(str(c[0]))
        for c in _rows(
            db,
            "select concept_id from item_concept where content_item_id = %s",
            (a.id,),
        )
    ]
    assert sorted(concepts) == sorted([a.concepts[-1], *sorted(a.concepts)[:4]])
    # Every moment tag is kept as an answer, at probability 1, marked full text.
    assert _one(
        db,
        "select count(*) from item_concept_probability "
        "where content_item_id = %s and model = 'moments:tags' and probability = 1",
        (a.id,),
    ) == len(a.concepts)
    b = tagged[0]
    assert _rows(
        db,
        "select difficulty, from_full_text from item_decision "
        "where content_item_id = %s and model = 'moments:tags'",
        (b,),
    ) == [(2.0, True)]
    assert (
        _one(
            db,
            "select count(*) from item_concept_probability "
            "where content_item_id = %s and model = 'moments:tags'",
            (b,),
        )
        == 1
    )
    # Its own tags stay as they are.
    assert _rows(
        db,
        "select model, from_full_text from item_tagging where content_item_id = %s",
        (b,),
    ) == [("m", True)]


def test_every_article_with_moment_vectors_has_its_own(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    other: list[int] = []

    def before(a: Article) -> None:
        for moment, head in zip(a.moments, [1.0, 3.0], strict=True):
            db.execute(
                "insert into moment_embedding (moment_id, model, embedding) "
                "values (%s, 'e', %s::vector)",
                (moment, _vector(head)),
            )
        # Stage A's trigger filled the mean; a lost one is filled again.
        db.execute(
            "update item_embedding set embedding = null where content_item_id = %s",
            (a.id,),
        )
        b = Article(db, moments=1)
        other.append(b.id)
        db.execute(
            "insert into moment_embedding (moment_id, model, embedding) "
            "values (%s, 'e', %s::vector)",
            (b.moments[0], _vector(5.0)),
        )
        db.execute("delete from item_embedding where content_item_id = %s", (b.id,))

    a = contracted(before)
    heads = _rows(
        db,
        "select content_item_id, (embedding::real[])[1] from item_embedding "
        "where content_item_id = any(%s) order by content_item_id",
        ([a.id, *other],),
    )
    assert heads == [(a.id, 2.0), (other[0], 5.0)]


def test_explainer_citations_name_their_article_and_no_moment(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    explainer: list[int] = []

    def before(a: Article) -> None:
        explainer.append(
            _id(
                db,
                "insert into concept_explainer (concept_id, script, citations, "
                "generator_model, prompt_version) values (%s, 's', "
                "jsonb_build_array("
                "jsonb_build_object('moment_id', %s::bigint, 'quote', 'one'), "
                "jsonb_build_object('moment_id', %s::bigint, 'content_item_id', "
                "%s::bigint, 'quote', 'two'), "
                "jsonb_build_object('moment_id', 999999999, 'quote', 'gone')), "
                "'m', 1) returning id",
                (a.concepts[0], a.moments[0], a.moments[1], a.id),
            )
        )

    a = contracted(before)
    citations = _one(
        db, "select citations from concept_explainer where id = %s", (explainer[0],)
    )
    assert citations == [
        {"content_item_id": a.id, "quote": "one"},
        {"content_item_id": a.id, "quote": "two"},
        {"quote": "gone"},
    ]


def test_section_overrides_become_the_articles_unless_it_has_one(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    other: list[int] = []

    def before(a: Article) -> None:
        override = (
            "insert into tag_override (content_item_id, heading, difficulty, "
            "concepts, updated_by, updated_at) values "
            "(%s, %s, %s::difficulty, %s, %s, %s::timestamptz)"
        )
        db.execute(
            override, (a.id, "Old", "beginner", ["x", "y", "z"], "a1", "2026-01-01")
        )
        db.execute(override, (a.id, "New", "advanced", ["y", "w"], "a2", "2026-02-01"))
        db.execute(override, (a.id, "Mid", "beginner", ["v", "u"], "a3", "2026-01-15"))
        b = Article(db, moments=0)
        other.append(b.id)
        db.execute(override, (b.id, "", "intermediate", ["mine"], "a1", "2026-01-01"))
        db.execute(override, (b.id, "Later", "advanced", ["s"], "a2", "2026-03-01"))

    a = contracted(before)
    rows = _rows(
        db,
        "select content_item_id, difficulty::text, concepts, updated_by "
        "from tag_override where content_item_id = any(%s) order by content_item_id",
        ([a.id, *other],),
    )
    # The union, most recent row's concepts first, up to five; the level and editor
    # of the most recent. The article's own row wins where it has one.
    assert rows == [
        (a.id, "advanced", ["y", "w", "v", "u", "x"], "a2"),
        (other[0], "intermediate", ["mine"], "a1"),
    ]


def test_section_notes_join_the_article_note_under_their_titles(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    others: list[str] = []
    long = "x" * 1990
    longer = "y" * 2000  # each as long as one could be

    def before(a: Article) -> None:
        note = (
            "insert into user_note (user_id, content_item_id, moment_id, "
            "section_title, body) values (%s, %s, %s, %s, %s)"
        )
        db.execute(note, (a.user, a.id, None, None, "Mine."))
        # Written out of page order, and one whose section was re-segmented away.
        db.execute(note, (a.user, a.id, a.moments[1], "Raft", long))
        db.execute(note, (a.user, a.id, None, "Gone", "Old."))
        db.execute(note, (a.user, a.id, a.moments[0], "Intro", "First."))
        db.execute(note, (a.user, a.id, None, "Older", longer))
        db.execute(note, (a.user, a.id, None, "Oldest", longer))
        # Another reader with section notes only.
        db.execute(
            "insert into app_user (id, name, email) values ('contract-other', 'n', "
            "'contract-other@example.test')"
        )
        others.append("contract-other")
        db.execute(note, ("contract-other", a.id, a.moments[0], "Intro", "Theirs."))

    a = contracted(before)
    notes = _rows(
        db,
        "select user_id, body from user_note where content_item_id = %s "
        "order by user_id",
        (a.id,),
    )
    # Nothing cut: the joined note runs far past the 2000 a person can type.
    assert sorted(notes) == sorted(
        [
            (others[0], "Intro\nTheirs."),
            (
                a.user,
                f"Mine.\n\nIntro\nFirst.\n\nRaft\n{long}\n\nGone\nOld."
                f"\n\nOlder\n{longer}\n\nOldest\n{longer}",
            ),
        ]
    )


def test_opened_and_finished_moments_are_opened_articles(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    def before(a: Article) -> None:
        db.execute(
            "insert into user_moment_opened (user_id, moment_id, opened_at) "
            "values (%s, %s, '2026-01-02')",
            (a.user, a.moments[0]),
        )
        db.execute(
            "insert into user_moment_finished (user_id, moment_id, method, "
            "finished_at) values (%s, %s, 'mark_done', '2026-01-05')",
            (a.user, a.moments[1]),
        )
        # Lost since stage A copied it: the fold brings it back.
        db.execute("delete from user_article_opened where user_id = %s", (a.user,))

    a = contracted(before)
    opened = _rows(
        db,
        "select opened_at::date::text, last_opened_at::date::text "
        "from user_article_opened where user_id = %s and content_item_id = %s",
        (a.user, a.id),
    )
    assert opened == [("2026-01-02", "2026-01-05")]
    # Completion stays the article's own (ADR-0058).
    assert (
        _rows(db, "select 1 from user_article_finished where user_id = %s", (a.user,))
        == []
    )


def test_moment_era_quiz_attempts_and_answers_are_kept_on_the_article(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    attempt: list[int] = []

    def before(a: Article) -> None:
        question = a.question(a.moments[0], 0)
        attempt.append(
            _id(
                db,
                "insert into quiz_attempt (user_id, content_item_id, moment_id, "
                "ends_at, finished_at) values (%s, %s, %s, now() + interval '1 min', "
                "now()) returning id",
                (a.user, a.id, a.moments[0]),
            )
        )
        db.execute(
            "insert into quiz_answer (attempt_id, question_id, chosen, correct, "
            "answered_at) values (%s, %s, 0, true, now())",
            (attempt[0], question),
        )

    a = contracted(before)
    assert _rows(
        db, "select content_item_id from quiz_attempt where id = %s", (attempt[0],)
    ) == [(a.id,)]
    assert (
        _one(
            db, "select count(*) from quiz_answer where attempt_id = %s", (attempt[0],)
        )
        == 1
    )


def test_moment_questions_stay_on_the_article_marked_as_carried_over(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    ids: dict[str, int] = {}

    def before(a: Article) -> None:
        ids["second"] = a.question(a.moments[1], 0)
        ids["first"] = a.question(a.moments[0], 0)
        ids["estimate"] = a.question(a.moments[0], 1, "estimate")
        for moment in a.moments:
            db.execute(
                "insert into question_estimate_drafted (moment_id, content_hash) "
                "values (%s, 'h')",
                (moment,),
            )
            db.execute(
                "insert into question_drafting (moment_id, attempt, retry_at) "
                "values (%s, 1, now())",
                (moment,),
            )

    a = contracted(before)
    questions = _rows(
        db,
        "select id, content_item_id, kind::text, article_ordinal, ordinal, "
        "from_moments, status::text from question where content_item_id = %s "
        "order by id",
        (a.id,),
    )
    # The slots stage A's trigger gave them as they were saved, the ordinal now the
    # same; none retired.
    assert sorted(questions) == sorted(
        [
            (ids["second"], a.id, "choice", 0, 0, True, "live"),
            (ids["first"], a.id, "choice", 1, 1, True, "live"),
            (ids["estimate"], a.id, "estimate", 0, 0, True, "live"),
        ]
    )
    # One drafted hash and one retry state for the article, the hash still carried.
    assert _rows(
        db,
        "select from_moments from question_estimate_drafted where content_item_id = %s",
        (a.id,),
    ) == [(True,)]
    assert (
        _one(
            db,
            "select count(*) from question_drafting where content_item_id = %s",
            (a.id,),
        )
        == 1
    )


def test_feeds_keep_one_entry_per_article_at_its_best_rank(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    def before(a: Article) -> None:
        entry = (
            "insert into user_feed_entry (user_id, chip, rank, content_item_id, "
            "moment_id, top_signal) "
            "values (%s, %s::break_length, %s, %s, %s, 'quality')"
        )
        db.execute(entry, (a.user, "1-3", 1, a.id, None))
        db.execute(entry, (a.user, "3-8", 2, a.id, a.moments[0]))
        db.execute(entry, (a.user, "3-8", 4, a.id, a.moments[1]))
        starter = (
            "insert into starter_feed_entry (topic, level, chip, rank, "
            "content_item_id, moment_id) values ('databases', 'beginner', "
            "%s::break_length, %s, %s, %s)"
        )
        db.execute(starter, ("8-15", 1, a.id, None))
        db.execute(starter, ("3-8", 3, a.id, a.moments[1]))
        db.execute(starter, ("3-8", 5, a.id, None))

    a = contracted(before)
    assert _rows(
        db,
        "select rank, content_item_id from user_feed_entry where user_id = %s",
        (a.user,),
    ) == [(2, a.id)]
    assert _rows(
        db,
        "select rank from starter_feed_entry where content_item_id = %s",
        (a.id,),
    ) == [(3,)]
    assert _rows(
        db,
        "select rank, link from user_feed_visible where user_id = %s",
        (a.user,),
    ) == [(2, f"https://contract.example.test/{a.user.removeprefix('contract-')}/a")]


def test_lowering_the_rights_purges_what_was_derived_from_the_full_text(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    def before(a: Article) -> None:
        a.question(a.moments[0], 0)
        db.execute(
            "insert into content_item_section (content_item_id, ordinal, word_count) "
            "values (%s, 0, 100)",
            (a.id,),
        )
        db.execute(
            "insert into moment_embedding (moment_id, model, embedding) "
            "values (%s, 'e', %s::vector)",
            (a.moments[0], _vector(1.0)),
        )
        for moment in a.moments:
            db.execute(
                "insert into question_estimate_drafted (moment_id, content_hash) "
                "values (%s, 'h')",
                (moment,),
            )
            db.execute(
                "insert into question_drafting (moment_id, attempt, retry_at) "
                "values (%s, 1, now())",
                (moment,),
            )
        # The title pass, and the moments' answers and tags read off the full text.
        db.execute(
            "insert into item_decision (content_item_id, model, content_hash, "
            "difficulty) values (%s, 'm', 'title', 1.0)",
            (a.id,),
        )
        db.execute(
            "insert into moment_decision (moment_id, model, content_hash, difficulty) "
            "values (%s, 'm', 'h', 1.0)",
            (a.moments[0],),
        )
        db.execute(
            "insert into moment_concept_probability (moment_id, model, concept_id, "
            "probability) values (%s, 'm', %s, 0.9)",
            (a.moments[0], a.concepts[0]),
        )
        db.execute(
            "insert into item_tagging (content_item_id, difficulty, model, "
            "prompt_version) values (%s, 'beginner', 'm', 5)",
            (a.id,),
        )
        db.execute(
            "insert into item_concept (content_item_id, concept_id) values (%s, %s)",
            (a.id, a.concepts[0]),
        )

    a = contracted(before)
    db.execute(
        "update source set rights_profile = 'metadata_only' where id = %s", (a.source,)
    )

    def count(table: str, where: str = "") -> object:
        return _one(
            db,
            f"select count(*) from {table} where content_item_id = %s {where}",
            (a.id,),
        )

    # ING-2: carried-over questions, and everything else read off the full text.
    for table in (
        "question",
        "content_item_section",
        "item_embedding",
        "question_estimate_drafted",
        "question_drafting",
        "item_tagging",
        "item_concept",
    ):
        assert count(table) == 0, table
    assert count("item_decision", "and from_full_text") == 0
    assert count("item_concept_probability", "and model like 'moments:%%'") == 0
    # The title pass stays, for the next tag pass to roll up.
    assert _rows(
        db, "select model from item_decision where content_item_id = %s", (a.id,)
    ) == [("m",)]


def test_an_estimate_drafted_on_the_article_and_its_moments_stays_carried_over(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    def before(a: Article) -> None:
        db.execute(
            "insert into question_estimate_drafted (moment_id, content_hash) "
            "values (%s, 'moment')",
            (a.moments[0],),
        )
        db.execute(
            "insert into question_estimate_drafted (content_item_id, content_hash) "
            "values (%s, 'article')",
            (a.id,),
        )
        db.execute(
            "insert into question_drafting (moment_id, attempt, retry_at) "
            "values (%s, 3, now())",
            (a.moments[1],),
        )
        db.execute(
            "insert into question_drafting (content_item_id, attempt, retry_at) "
            "values (%s, 1, now())",
            (a.id,),
        )

    a = contracted(before)
    assert _rows(
        db,
        "select content_hash, from_moments from question_estimate_drafted "
        "where content_item_id = %s",
        (a.id,),
    ) == [("article", True)]
    # The article's own retry state wins.
    assert _rows(
        db,
        "select attempt from question_drafting where content_item_id = %s",
        (a.id,),
    ) == [(1,)]


def test_ask_answer_citations_lose_their_moment_ids(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    question: list[str] = []

    def before(a: Article) -> None:
        asked = _one(
            db,
            "insert into ask_question (user_id, text, idempotency_key) "
            "values (%s, 'why?', 'k') returning id::text",
            (a.user,),
        )
        assert isinstance(asked, str)
        question.append(asked)
        db.execute(
            "insert into ask_answer (question_id, outcome, text, citations, model, "
            "prompt_version, cost_usd) values (%s::uuid, 'answered', 'x', "
            "jsonb_build_array(jsonb_build_object('passage', 'm1', 'item_id', "
            "%s::text, 'moment_id', '1'), jsonb_build_object('passage', 'c', "
            "'concept_id', '2')), 'm', 1, 0)",
            (asked, a.id),
        )

    a = contracted(before)
    assert _one(
        db,
        "select citations from ask_answer where question_id = %s::uuid",
        (question[0],),
    ) == [
        {"passage": "m1", "item_id": str(a.id)},
        {"passage": "c", "concept_id": "2"},
    ]


def test_avoided_concepts_read_the_articles_override(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    slugs: list[str] = []

    def before(a: Article) -> None:
        slug = _one(db, "select slug from concept where id = %s", (a.concepts[1],))
        assert isinstance(slug, str)
        slugs.append(slug)
        db.execute(
            "insert into tag_override (content_item_id, heading, difficulty, "
            "concepts, updated_by) values (%s, 'Section', 'beginner', %s, 'admin')",
            (a.id, [slug]),
        )
        db.execute(
            "insert into item_feedback (user_id, content_item_id, kind) "
            "values (%s, %s, 'not_interested')",
            (a.user, a.id),
        )

    a = contracted(before)
    # The section's override became the article's, and the view reads it.
    assert _rows(
        db, "select slug from user_avoided_concept where user_id = %s", (a.user,)
    ) == [(slugs[0],)]


def test_the_daily_challenge_picks_article_questions_with_working_links(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    ids: dict[str, int] = {}

    def before(a: Article) -> None:
        ids["choice"] = a.question(a.moments[0], 0)
        ids["estimate"] = a.question(a.moments[0], 1, "estimate")

    a = contracted(before)
    pick = "select daily_challenge_fit(current_date, %s::question_kind, null)"
    assert _one(db, pick, ("choice",)) == ids["choice"]
    assert _one(db, pick, ("estimate",)) == ids["estimate"]
    # A broken link keeps a free-answer question out; a choice still plays (as before).
    db.execute("update content_item set link_broken_at = now() where id = %s", (a.id,))
    assert _one(db, pick, ("estimate",)) is None
    assert _one(db, pick, ("choice",)) == ids["choice"]


def test_a_chat_tagged_article_is_marked_full_text_and_purged(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    def before(a: Article) -> None:
        # Tagged since stage B by a chat model, which read its stored full text.
        db.execute(
            "insert into content_item_private_text (content_item_id, text) "
            "values (%s, 'body')",
            (a.id,),
        )
        db.execute(
            "insert into item_tagging (content_item_id, difficulty, model, "
            "prompt_version) values (%s, 'beginner', 'chat/model', 5)",
            (a.id,),
        )

    a = contracted(before)
    assert _rows(
        db,
        "select from_full_text from item_tagging where content_item_id = %s",
        (a.id,),
    ) == [(True,)]
    db.execute(
        "update source set rights_profile = 'metadata_only' where id = %s", (a.source,)
    )
    assert (
        _rows(db, "select 1 from item_tagging where content_item_id = %s", (a.id,))
        == []
    )


def test_a_source_lowered_before_the_migration_keeps_nothing_read_off_its_text(
    db: psycopg.Connection, contracted: Contracted
) -> None:
    kept: list[int] = []

    def before(a: Article) -> None:
        # Lowered after stage A copied its moments' answers and tagged it: the purges
        # then took its text and moments but left the tagging.
        db.execute(
            "insert into item_decision (content_item_id, model, content_hash, "
            "difficulty, decided_at) values (%s, 'moments:m', 'h', 1.0, '2026-11-27'), "
            "(%s, 'm', 'whole', 1.0, '2026-11-27 12:00'), "
            "(%s, 'title', 'title', 1.0, '2026-10-01')",
            (a.id, a.id, a.id),
        )
        db.execute(
            "insert into item_tagging (content_item_id, difficulty, model, "
            "prompt_version) values (%s, 'beginner', 'chat/model', 5)",
            (a.id,),
        )
        db.execute(
            "update source set rights_profile = 'metadata_only' where id = %s",
            (a.source,),
        )
        # An article on a full-text source keeps its tagging as it is.
        b = Article(db, moments=0)
        kept.append(b.id)
        db.execute(
            "insert into item_decision (content_item_id, model, content_hash, "
            "difficulty, decided_at) "
            "values (%s, 'm', 'whole', 1.0, '2026-11-27 12:00')",
            (b.id,),
        )
        db.execute(
            "insert into item_tagging (content_item_id, difficulty, model, "
            "prompt_version) values (%s, 'beginner', 'chat/model', 5)",
            (b.id,),
        )

    a = contracted(before)
    assert _rows(
        db, "select model from item_decision where content_item_id = %s", (a.id,)
    ) == [("title",)]
    assert (
        _rows(db, "select 1 from item_tagging where content_item_id = %s", (a.id,))
        == []
    )
    b = kept[0]
    assert _rows(
        db, "select model from item_decision where content_item_id = %s", (b,)
    ) == [("m",)]
    assert _rows(
        db, "select model from item_tagging where content_item_id = %s", (b,)
    ) == [("chat/model",)]
