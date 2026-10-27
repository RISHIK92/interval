"""Store contract (ADR-0012): the same repository cases against the in-memory fake and
the Postgres adapter, so logic tested on the fake behaves the same on the database.

Ports have no read methods that only tests need; each store gets a test-side probe that
inspects its state (internal fields for the fake, SQL for Postgres).
"""

from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Protocol, get_args
from uuid import uuid4

import psycopg
import pytest

from interval_db.generated import BreakLength, Difficulty, RightsProfile, Topic
from interval_jobs.adapters.memory import (
    GOAL_CONCEPTS,
    RANKING_DEFAULTS,
    InMemoryAi,
    InMemoryStore,
    StoredUser,
)
from interval_jobs.adapters.postgres import PostgresAi, PostgresStore
from interval_jobs.concepts.graph import ConceptSeedError, parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.ports import (
    LEARNING_GOALS,
    AiLedger,
    Arm,
    ArmOutcome,
    ConceptCycleError,
    ConceptEdge,
    ConceptGraph,
    DuplicateInviteCode,
    FeedEntry,
    Finished,
    ItemDecisions,
    MomentRow,
    NoteInput,
    NoteKey,
    NoteRef,
    QuestionBatchEntry,
    QuestionDraft,
    RankedEntry,
    RightsViolation,
    Section,
    SectionRow,
    SourceSettings,
    Store,
    TagResult,
    Tags,
    Usage,
    UserPreferences,
    Validators,
)


def email_of(user_id: str) -> str:
    return f"{user_id}@contract.example.test"


class Probe(Protocol):
    def enable_moments(self, source_id: int) -> None: ...
    def excerpt(self, item_id: int) -> str | None: ...
    def full_text(self, item_id: int) -> str | None: ...
    def moments(self, item_id: int) -> list[tuple[int, int, str]]: ...
    def feed_titles(self, chip: BreakLength = "3-8") -> list[str]: ...
    def feed_state(self, user_id: str) -> datetime | None: ...
    def feed_entries(
        self, user_id: str, chip: BreakLength
    ) -> list[tuple[int, int | None]]: ...
    def starter_ids(
        self, topic: str, level: Difficulty, chip: BreakLength
    ) -> list[int]: ...
    def age_sessions(self, user_id: str, days: int) -> None: ...
    def disable_moments(self, source_id: int) -> None: ...
    def invite(
        self, code: str
    ) -> tuple[str, int, int, datetime, str | None] | None: ...
    def add_user(
        self, user_id: str, anonymous: bool, session_expires: list[datetime]
    ) -> None: ...
    def user_ids(self) -> set[str]: ...
    def capabilities(self, user_id: str) -> set[str]: ...
    def delete_user(self, user_id: str) -> None: ...
    def source_state(self, name: str) -> tuple[object, ...] | None: ...
    def has_item(self, item_id: int) -> bool: ...
    def primary_of(self, item_id: int) -> int | None: ...
    def oversized(self, item_id: int) -> list[bool]: ...
    def reset_concepts(self) -> None: ...
    def set_boundaries(self, item_id: int, headings: list[str]) -> None: ...
    def switch_moments_off(self, source_id: int, off: bool) -> None: ...
    # What the web app writes about a user (P1-W4-S01, W4-S07).
    def set_preferences(
        self, user_id: str, topics: list[str], goals: list[str] | None = None
    ) -> None: ...
    def give_feedback(self, user_id: str, item_id: int, kind: str) -> None: ...
    def save(self, user_id: str, item_id: int) -> None: ...
    def hide_source(self, user_id: str, source_id: int) -> None: ...
    def reset_inferred(self, user_id: str) -> None: ...
    def record_arm(self, arm: Arm, shown: int, finished: int) -> None: ...
    def finish(self, user_id: str, moment_id: int, item_id: int) -> None: ...
    def correct_concepts(self, item_id: int, slugs: list[str]) -> None: ...
    def correct_moment_concepts(
        self, item_id: int, heading: str, slugs: list[str]
    ) -> None: ...
    def flag_question(self, question_id: int) -> None: ...
    def reviews(self) -> list[tuple[int, str, bool]]: ...
    def decide_review(self, question_id: int) -> None: ...
    def question_difficulty(self, question_id: int) -> str | None: ...
    def retire_question(self, question_id: int) -> None: ...
    def override_level(self, item_id: int, heading: str, level: str) -> None: ...
    def simhash(self, item_id: int) -> int | None: ...


@dataclass
class MemoryProbe:
    s: InMemoryStore

    def enable_moments(self, source_id: int) -> None:
        self.s.sources.set_moments_enabled(source_id, True)

    def disable_moments(self, source_id: int) -> None:
        self.s.sources.set_moments_enabled(source_id, False)

    def add_user(
        self, user_id: str, anonymous: bool, session_expires: list[datetime]
    ) -> None:
        self.s.users.rows[user_id] = StoredUser(
            user_id,
            anonymous,
            list(session_expires),
            email=email_of(user_id),
            session_seen=datetime.now(UTC) if session_expires else None,
        )

    def user_ids(self) -> set[str]:
        return set(self.s.users.rows)

    def capabilities(self, user_id: str) -> set[str]:
        return set(self.s.users.rows[user_id].capabilities)

    def delete_user(self, user_id: str) -> None:
        del self.s.users.rows[user_id]

    def source_state(self, name: str) -> tuple[object, ...] | None:
        row = next((r for r in self.s.sources.rows.values() if r.name == name), None)
        if row is None:
            return None
        return (
            row.active,
            row.feed_url,
            row.rights_profile,
            row.moments_enabled,
            row.paywalled,
            row.quality_score,
            tuple(row.topics),
        )

    def has_item(self, item_id: int) -> bool:
        return item_id in self.s.items.rows

    def primary_of(self, item_id: int) -> int | None:
        return self.s.items.rows[item_id].duplicate_of

    def oversized(self, item_id: int) -> list[bool]:
        return [m.row.oversized for m in self.s.moments.for_item(item_id)]

    def reset_concepts(self) -> None:
        pass  # a fresh store has no graph

    def set_boundaries(self, item_id: int, headings: list[str]) -> None:
        self.s.items.boundary_overrides[item_id] = headings

    def switch_moments_off(self, source_id: int, off: bool) -> None:
        self.s.sources.switch_moments_off(source_id, off)

    def set_preferences(
        self, user_id: str, topics: list[str], goals: list[str] | None = None
    ) -> None:
        self.s.ranking.preferences_by_user[user_id] = UserPreferences(
            [t for t in get_args(Topic.__value__) if t in topics],
            "beginner",
            "3-8",
            [g for g in LEARNING_GOALS if g in (goals or [])],
        )

    def give_feedback(self, user_id: str, item_id: int, kind: str) -> None:
        self.s.ranking.feedback.append((user_id, item_id, kind))

    def save(self, user_id: str, item_id: int) -> None:
        self.s.ranking.saves.append((user_id, item_id))

    def hide_source(self, user_id: str, source_id: int) -> None:
        self.s.ranking.hidden.add((user_id, source_id))

    def finish(self, user_id: str, moment_id: int, item_id: int) -> None:
        self.s.ranking.finished_moments.add((user_id, moment_id))
        self.s.ranking.finished_items.add((user_id, item_id))

    def record_arm(self, arm: Arm, shown: int, finished: int) -> None:
        self.s.ranking.outcomes[arm] = ArmOutcome(shown, finished)

    def reset_inferred(self, user_id: str) -> None:
        # As the web's resetInferred: More and Less like this go, the time is kept.
        ranking = self.s.ranking
        ranking.feedback = [
            f for f in ranking.feedback if f[0] != user_id or f[2] == "not_interested"
        ]
        ranking.resets[user_id] = len(ranking.feedback)

    def correct_concepts(self, item_id: int, slugs: list[str]) -> None:
        self.s.tags.item_concept_overrides[item_id] = frozenset(slugs)

    def correct_moment_concepts(
        self, item_id: int, heading: str, slugs: list[str]
    ) -> None:
        # As the Postgres probe's row: the level comes with the concepts.
        self.s.tags.moment_concept_overrides[(item_id, heading)] = frozenset(slugs)
        self.s.tags.overrides[(item_id, heading)] = "beginner"

    def flag_question(self, question_id: int) -> None:
        next(q for q in self.s.questions.rows if q.id == question_id).status = "flagged"

    def reviews(self) -> list[tuple[int, str, bool]]:
        return sorted(self.s.questions.reviews)

    def decide_review(self, question_id: int) -> None:
        # What the admin page's Keep does (P2-W8-S03): decided, and a flagged question
        # is live again.
        self.s.questions.reviews = [
            (q, r, True if q == question_id else d)
            for q, r, d in self.s.questions.reviews
        ]
        question = next(q for q in self.s.questions.rows if q.id == question_id)
        if question.status == "flagged":
            question.status = "live"

    def retire_question(self, question_id: int) -> None:
        next(q for q in self.s.questions.rows if q.id == question_id).status = "retired"

    def question_difficulty(self, question_id: int) -> str | None:
        return next(q for q in self.s.questions.rows if q.id == question_id).difficulty

    def override_level(self, item_id: int, heading: str, level: str) -> None:
        assert level in ("beginner", "intermediate", "advanced")
        self.s.tags.overrides[(item_id, heading)] = level

    def simhash(self, item_id: int) -> int | None:
        return self.s.items.rows[item_id].simhash

    def invite(self, code: str) -> tuple[str, int, int, datetime, str | None] | None:
        row = self.s.invites.rows.get(code)
        if row is None:
            return None
        return (row.beta_group, row.max_uses, row.used_count, row.expires_at, row.note)

    def excerpt(self, item_id: int) -> str | None:
        return self.s.items.rows[item_id].excerpt

    def full_text(self, item_id: int) -> str | None:
        return self.s.items.rows[item_id].full_text

    def moments(self, item_id: int) -> list[tuple[int, int, str]]:
        return [
            (m.id, m.row.ordinal, m.row.title) for m in self.s.moments.for_item(item_id)
        ]

    def feed_titles(self, chip: BreakLength = "3-8") -> list[str]:
        by_id = {m.id: m.row.title for m in self.s.moments.rows}
        return [
            by_id[r.moment_id]
            for chips in self.s.feed.users.values()
            for r in chips.get(chip, [])
            if r.moment_id is not None  # moment entries, as the Postgres probe reads
        ]

    def feed_state(self, user_id: str) -> datetime | None:
        return self.s.feed.computed.get(user_id)

    def feed_entries(
        self, user_id: str, chip: BreakLength
    ) -> list[tuple[int, int | None]]:
        rows = self.s.feed.users.get(user_id, {}).get(chip, [])
        return [(r.item_id, r.moment_id) for r in rows]

    def starter_ids(
        self, topic: str, level: Difficulty, chip: BreakLength
    ) -> list[int]:
        rows = self.s.feed.starters.get((topic, level, chip), [])
        return [r.moment_id for r in rows if r.moment_id is not None]

    def age_sessions(self, user_id: str, days: int) -> None:
        user = self.s.users.rows[user_id]
        user.session_seen = datetime.now(UTC) - timedelta(days=days)


@dataclass
class PostgresProbe:
    conn: psycopg.Connection

    def enable_moments(self, source_id: int) -> None:
        self.conn.execute(
            "update source set moments_seeded = true, moments_enabled = true "
            "where id = %s",
            (source_id,),
        )

    def disable_moments(self, source_id: int) -> None:
        self.conn.execute(
            "update source set moments_seeded = false, moments_enabled = false "
            "where id = %s",
            (source_id,),
        )

    def add_user(
        self, user_id: str, anonymous: bool, session_expires: list[datetime]
    ) -> None:
        code = self.conn.execute(
            "insert into invite_code (code, beta_group, max_uses, expires_at) "
            "values (%s, 'student', 10, now() + interval '1 day') "
            "on conflict (code) do update set max_uses = 10 returning id",
            ("CONTRACTUSERS",),
        ).fetchone()
        assert code is not None
        self.conn.execute(
            "insert into app_user "
            "(id, name, email, is_anonymous, beta_group, invite_code_id) "
            "values (%s, 'n', %s, %s, 'student', %s)",
            (user_id, email_of(user_id), anonymous, code[0]),
        )
        for i, expires in enumerate(session_expires):
            self.conn.execute(
                "insert into auth_session (id, expires_at, token, updated_at, user_id) "
                "values (%s, %s, %s, now(), %s)",
                (f"{user_id}-s{i}", expires, f"{user_id}-t{i}", user_id),
            )

    def delete_user(self, user_id: str) -> None:
        self.conn.execute("delete from app_user where id = %s", (user_id,))

    def source_state(self, name: str) -> tuple[object, ...] | None:
        row = self.conn.execute(
            "select active, feed_url, rights_profile::text, moments_enabled, "
            "paywalled, quality_score, topics from source where name = %s",
            (name,),
        ).fetchone()
        return None if row is None else (*row[:6], tuple(row[6]))

    def has_item(self, item_id: int) -> bool:
        row = self.conn.execute(
            "select 1 from content_item where id = %s", (item_id,)
        ).fetchone()
        return row is not None

    def capabilities(self, user_id: str) -> set[str]:
        rows = self.conn.execute(
            "select capability::text from user_capability where user_id = %s",
            (user_id,),
        ).fetchall()
        return {r[0] for r in rows}

    def user_ids(self) -> set[str]:
        rows = self.conn.execute(
            "select id from app_user where email like '%%@contract.example.test'"
        ).fetchall()
        return {r[0] for r in rows}

    def invite(self, code: str) -> tuple[str, int, int, datetime, str | None] | None:
        row = self.conn.execute(
            "select beta_group::text, max_uses, used_count, expires_at, note "
            "from invite_code where code = %s",
            (code,),
        ).fetchone()
        return None if row is None else (row[0], row[1], row[2], row[3], row[4])

    def excerpt(self, item_id: int) -> str | None:
        row = self.conn.execute(
            "select excerpt from content_item where id = %s", (item_id,)
        ).fetchone()
        assert row is not None
        value: str | None = row[0]
        return value

    def full_text(self, item_id: int) -> str | None:
        row = self.conn.execute(
            "select text from content_item_private_text where content_item_id = %s",
            (item_id,),
        ).fetchone()
        return None if row is None else str(row[0])

    def moments(self, item_id: int) -> list[tuple[int, int, str]]:
        return self.conn.execute(
            "select id, ordinal, title from moment where content_item_id = %s "
            "order by ordinal",
            (item_id,),
        ).fetchall()

    def override_level(self, item_id: int, heading: str, level: str) -> None:
        self.conn.execute(
            "insert into tag_override (content_item_id, heading, difficulty, "
            "concepts, updated_by) values (%s, %s, %s, '{}', 'contract-test')",
            (item_id, heading, level),
        )

    def set_preferences(
        self, user_id: str, topics: list[str], goals: list[str] | None = None
    ) -> None:
        # At least one goal, as the database requires (ADR-0015).
        self.conn.execute(
            "insert into user_preferences "
            "(user_id, topics, level, break_length, goals) "
            "values (%s, %s::topic[], 'beginner', '3-8', %s::learning_goal[])",
            (user_id, topics, goals or ["stay-sharp"]),
        )

    def give_feedback(self, user_id: str, item_id: int, kind: str) -> None:
        self.conn.execute(
            # clock_timestamp: given after an earlier reset in the same transaction.
            "insert into item_feedback (user_id, content_item_id, kind, given_at) "
            "values (%s, %s, %s, clock_timestamp())",
            (user_id, item_id, kind),
        )

    def save(self, user_id: str, item_id: int) -> None:
        # Spaced out in time so "newest first" is well defined in one transaction.
        self.conn.execute(
            "insert into user_save (user_id, content_item_id, saved_at) "
            "values (%s, %s, clock_timestamp())",
            (user_id, item_id),
        )

    def finish(self, user_id: str, moment_id: int, item_id: int) -> None:
        self.conn.execute(
            "insert into user_moment_finished (user_id, moment_id, method) "
            "values (%s, %s, 'mark_done')",
            (user_id, moment_id),
        )
        self.conn.execute(
            "insert into user_article_finished (user_id, content_item_id, method) "
            "values (%s, %s, 'mark_done')",
            (user_id, item_id),
        )

    def record_arm(self, arm: Arm, shown: int, finished: int) -> None:
        self.conn.execute(
            "insert into explore_arm_outcome (kind, arm, shown, finished) "
            "values (%s, %s, %s, %s)",
            (arm.kind, arm.key, shown, finished),
        )

    def reset_inferred(self, user_id: str) -> None:
        # As the web's resetInferred: More and Less like this go, the time is kept.
        self.conn.execute(
            "delete from item_feedback where user_id = %s "
            "and kind in ('more_like_this', 'less_like_this')",
            (user_id,),
        )
        self.conn.execute(
            "insert into user_inferred_reset (user_id, reset_at) "
            "values (%s, clock_timestamp()) "
            "on conflict (user_id) do update set reset_at = excluded.reset_at",
            (user_id,),
        )

    def hide_source(self, user_id: str, source_id: int) -> None:
        self.conn.execute(
            "insert into user_hidden_source (user_id, source_id) values (%s, %s)",
            (user_id, source_id),
        )

    def correct_concepts(self, item_id: int, slugs: list[str]) -> None:
        self.conn.execute(
            "insert into tag_override (content_item_id, heading, difficulty, concepts, "
            "updated_by) values (%s, '', 'beginner', %s, 'contract-test')",
            (item_id, slugs),
        )

    def flag_question(self, question_id: int) -> None:
        self.conn.execute(
            "update question set status = 'flagged' where id = %s", (question_id,)
        )

    def reviews(self) -> list[tuple[int, str, bool]]:
        return sorted(
            (int(qid), str(reason), bool(decided))
            for qid, reason, decided in self.conn.execute(
                "select question_id, reason, decision is not null from question_review"
            ).fetchall()
        )

    def decide_review(self, question_id: int) -> None:
        self.conn.execute(
            "update question_review set decision = 'keep', decided_by = 't', "
            "decided_at = now() where question_id = %s and decision is null",
            (question_id,),
        )
        self.conn.execute(
            "update question set status = 'live' where id = %s and status = 'flagged'",
            (question_id,),
        )

    def retire_question(self, question_id: int) -> None:
        self.conn.execute(
            "update question set status = 'retired' where id = %s", (question_id,)
        )

    def question_difficulty(self, question_id: int) -> str | None:
        row = self.conn.execute(
            "select difficulty from question where id = %s", (question_id,)
        ).fetchone()
        assert row is not None
        return None if row[0] is None else str(row[0])

    def correct_moment_concepts(
        self, item_id: int, heading: str, slugs: list[str]
    ) -> None:
        self.conn.execute(
            "insert into tag_override (content_item_id, heading, difficulty, concepts, "
            "updated_by) values (%s, %s, 'beginner', %s, 'contract-test')",
            (item_id, heading, slugs),
        )

    def switch_moments_off(self, source_id: int, off: bool) -> None:
        # What the web admin page runs (P1-W3-S06).
        self.conn.execute(
            "update source set moments_switched_off = %s, "
            "moments_enabled = moments_seeded and not %s where id = %s",
            (off, off, source_id),
        )

    def set_boundaries(self, item_id: int, headings: list[str]) -> None:
        # The web admin page writes these (P1-W3-S05).
        self.conn.execute(
            "insert into moment_boundary_override (content_item_id, headings, "
            "updated_by) values (%s, %s, 'contract-test')",
            (item_id, headings),
        )

    def reset_concepts(self) -> None:
        # A local database may hold the real graph; the test's transaction rolls this
        # back. Truncate skips the never-deleted row trigger.
        self.conn.execute("truncate concept_edge, graph_version, concept cascade")

    def oversized(self, item_id: int) -> list[bool]:
        rows = self.conn.execute(
            "select oversized from moment where content_item_id = %s order by ordinal",
            (item_id,),
        ).fetchall()
        return [bool(r[0]) for r in rows]

    def primary_of(self, item_id: int) -> int | None:
        row = self.conn.execute(
            "select duplicate_of from content_item where id = %s", (item_id,)
        ).fetchone()
        assert row is not None
        return row[0]

    def simhash(self, item_id: int) -> int | None:
        row = self.conn.execute(
            "select simhash from content_item where id = %s", (item_id,)
        ).fetchone()
        assert row is not None
        return row[0]

    def feed_titles(self, chip: BreakLength = "3-8") -> list[str]:
        rows = self.conn.execute(
            "select m.title from user_feed_entry fe "
            "join moment m on m.id = fe.moment_id "
            "join content_item ci on ci.id = m.content_item_id "
            "where ci.guid like 'contract-%%' and fe.chip = %s "
            "order by fe.user_id, fe.rank",
            (chip,),
        ).fetchall()
        return [r[0] for r in rows]

    def feed_state(self, user_id: str) -> datetime | None:
        row = self.conn.execute(
            "select computed_at from user_feed_state where user_id = %s", (user_id,)
        ).fetchone()
        return None if row is None else row[0]

    def feed_entries(
        self, user_id: str, chip: BreakLength
    ) -> list[tuple[int, int | None]]:
        rows = self.conn.execute(
            "select content_item_id, moment_id from user_feed_entry "
            "where user_id = %s and chip = %s order by rank",
            (user_id, chip),
        ).fetchall()
        return [(int(r[0]), r[1]) for r in rows]

    def starter_ids(
        self, topic: str, level: Difficulty, chip: BreakLength
    ) -> list[int]:
        rows = self.conn.execute(
            "select moment_id from starter_feed_entry where topic = %s "
            "and level = %s::difficulty and chip = %s::break_length "
            "and moment_id is not null order by rank",
            (topic, level, chip),
        ).fetchall()
        return [r[0] for r in rows]

    def age_sessions(self, user_id: str, days: int) -> None:
        self.conn.execute(
            "update auth_session set updated_at = now() - make_interval(days => %s) "
            "where user_id = %s",
            (days, user_id),
        )


@pytest.fixture(params=["memory", "postgres"])
def store(request: pytest.FixtureRequest) -> Iterator[tuple[Store, Probe]]:
    if request.param == "memory":
        memory = InMemoryStore()
        yield memory, MemoryProbe(memory)
        return
    conn: psycopg.Connection = request.getfixturevalue("conn")
    yield PostgresStore(conn), PostgresProbe(conn)


# The AI ledger isn't part of the Store: it commits on its own connection (OPS-4).
@pytest.fixture(params=["memory", "postgres"])
def ledger(request: pytest.FixtureRequest) -> Iterator[tuple[AiLedger, Probe]]:
    if request.param == "memory":
        memory = InMemoryStore()
        yield InMemoryAi(memory.users), MemoryProbe(memory)
        return
    conn: psycopg.Connection = request.getfixturevalue("conn")
    yield PostgresAi(conn), PostgresProbe(conn)


def entry(guid: str, published: datetime | None = None, title: str = "T") -> FeedEntry:
    return FeedEntry(
        guid=f"contract-{guid}",
        link=f"https://contract.example.test/{guid}",
        title=title,
        author=None,
        published_at=published,
        updated_at=None,
        summary="s",
    )


def source(s: Store, profile: RightsProfile = "full_text_internal") -> int:
    return s.sources.upsert(
        name=f"contract-{profile}",
        feed_url=f"https://contract.example.test/{profile}.xml",
        rights_profile=profile,
        homepage=None,
    )


def moment(ordinal: int, title: str) -> MomentRow:
    return MomentRow(ordinal, title, 1, "https://contract.example.test/a", "page_top")


def test_source_upsert_is_idempotent_by_name_and_get_reads_it_back(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    first = source(s, "excerpt")
    again = s.sources.upsert(
        name="contract-excerpt",
        feed_url="https://contract.example.test/moved.xml",
        rights_profile="excerpt",
        homepage=None,
    )
    record = s.sources.get(first)
    assert again == first
    assert record is not None
    assert (record.feed_url, record.rights_profile) == (
        "https://contract.example.test/moved.xml",
        "excerpt",
    )
    assert s.sources.get(10**12) is None


def test_item_upsert_by_guid_keeps_or_drops_the_excerpt(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s, "excerpt")
    item = s.items.upsert_from_feed(sid, entry("g1"), keep_excerpt=True)
    s.items.set_excerpt(item, "an excerpt")
    assert (
        s.items.upsert_from_feed(sid, entry("g1", title="T2"), keep_excerpt=True)
        == item
    )
    assert probe.excerpt(item) == "an excerpt"
    s.items.upsert_from_feed(sid, entry("g1"), keep_excerpt=False)
    assert probe.excerpt(item) is None


def test_full_text_store_replace_and_drop(store: tuple[Store, Probe]) -> None:
    s, probe = store
    item = s.items.upsert_from_feed(source(s), entry("g2"), keep_excerpt=False)
    s.items.store_full_text(item, "first")
    s.items.store_full_text(item, "second")
    assert probe.full_text(item) == "second"
    s.items.drop_full_text(item)
    assert probe.full_text(item) is None


def test_sections_are_replaced_and_read_in_order(store: tuple[Store, Probe]) -> None:
    s, _ = store
    item = s.items.upsert_from_feed(source(s), entry("g3"), keep_excerpt=False)
    s.items.replace_sections(
        item, [Section("A", 2, "a", 10), Section(None, None, None, 5)]
    )
    s.items.replace_sections(item, [Section("B", 2, None, 7), Section("C", 3, "c", 9)])
    assert s.items.sections(item) == [
        SectionRow("B", None, 7, 2),
        SectionRow("C", "c", 9, 3),
    ]


def test_segmentation_input_reflects_the_source(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s)
    item = s.items.upsert_from_feed(sid, entry("g4", title="Title"), keep_excerpt=False)
    probe.enable_moments(sid)
    got = s.items.for_segmentation(item)
    assert got is not None
    assert (got.title, got.canonical_url, got.rights_profile, got.moments_enabled) == (
        "Title",
        "https://contract.example.test/g4",
        "full_text_internal",
        True,
    )
    assert s.items.for_segmentation(10**12) is None


def test_moments_replace_keeps_ids_by_ordinal_and_removes_extras(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("g5"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "a"), moment(1, "b"), moment(2, "c")])
    ids = [m[0] for m in probe.moments(item)]
    s.moments.replace(item, [moment(0, "a2"), moment(1, "b2")])
    assert probe.moments(item) == [(ids[0], 0, "a2"), (ids[1], 1, "b2")]


def test_moment_links_cover_sources_with_moments_on(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    on, off = source(s), source(s, "full_text_display")
    probe.enable_moments(on)
    probe.enable_moments(off)
    item = s.items.upsert_from_feed(on, entry("links"), keep_excerpt=False)
    other = s.items.upsert_from_feed(off, entry("links-off"), keep_excerpt=False)
    s.moments.replace(item, [moment(1, "second"), moment(0, "first")])
    s.moments.replace(other, [moment(0, "gone")])
    probe.disable_moments(off)
    links = s.moments.links(on)
    assert [(m.title, m.source_name, m.item_id) for m in links] == [
        ("first", "contract-full_text_internal", item),
        ("second", "contract-full_text_internal", item),
    ]
    assert links[0].link == "https://contract.example.test/a"
    assert links[0].link_type == "page_top"
    everything = s.moments.links(None)
    assert {m.moment_id for m in links} <= {m.moment_id for m in everything}
    assert "gone" not in {m.title for m in everything}


def test_link_health_keeps_the_first_break_and_clears_on_recovery(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    item = s.items.upsert_from_feed(source(s), entry("health"), keep_excerpt=False)
    assert item in s.items.ids()
    assert s.items.link_health(item) == ("https://contract.example.test/health", None)
    first = datetime(2026, 10, 19, tzinfo=UTC)
    s.items.set_link_broken(item, first)
    s.items.set_link_broken(item, first + timedelta(days=7))
    assert s.items.link_health(item) == ("https://contract.example.test/health", first)
    s.items.set_link_broken(item, None)
    assert s.items.link_health(item) == ("https://contract.example.test/health", None)
    assert s.items.link_health(10**12) is None


def test_the_oversized_flag_is_stored_and_updated(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("g6"), keep_excerpt=False)
    big = replace(moment(0, "big"), oversized=True)
    s.moments.replace(item, [big, moment(1, "small")])
    assert probe.oversized(item) == [True, False]
    s.moments.replace(
        item, [moment(0, "big"), replace(moment(1, "small"), oversized=True)]
    )
    assert probe.oversized(item) == [False, True]


def change_profile(s: Store, profile_from: RightsProfile, to: RightsProfile) -> None:
    s.sources.upsert(
        name=f"contract-{profile_from}",
        feed_url=f"https://contract.example.test/{profile_from}.xml",
        rights_profile=to,
        homepage=None,
    )


def test_lowering_full_text_purges_text_sections_moments_and_feed(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(
        sid, entry("purge", datetime(2099, 12, 1, tzinfo=UTC)), keep_excerpt=False
    )
    s.items.store_full_text(item, "body")
    s.items.replace_sections(item, [Section("A", 2, "a", 10)])
    s.moments.replace(item, [moment(0, "purge0")])
    put_in_feed(s, probe, item)

    change_profile(s, "full_text_internal", "excerpt")
    assert probe.full_text(item) is None
    assert s.items.sections(item) == []
    assert probe.moments(item) == []
    assert "purge0" not in probe.feed_titles()


def test_lowering_excerpt_purges_the_excerpt(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s, "excerpt")
    item = s.items.upsert_from_feed(sid, entry("ex"), keep_excerpt=True)
    s.items.set_excerpt(item, "e")
    change_profile(s, "excerpt", "metadata_only")
    assert probe.excerpt(item) is None


def test_switching_moments_off_purges_moments(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("off"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "off0")])
    probe.disable_moments(sid)
    assert probe.moments(item) == []


def test_writes_the_profile_forbids_are_refused(store: tuple[Store, Probe]) -> None:
    s, _ = store
    meta = s.items.upsert_from_feed(source(s, "metadata_only"), entry("m"), False)
    full = s.items.upsert_from_feed(source(s), entry("f"), False)
    for write in (
        lambda: s.items.store_full_text(meta, "x"),
        lambda: s.items.replace_sections(meta, [Section("A", 2, None, 1)]),
        lambda: s.items.set_excerpt(full, "x"),
        lambda: s.moments.replace(full, [moment(0, "no switch")]),
    ):
        with pytest.raises(RightsViolation):
            write()


def test_issued_invites_are_stored_normalised_with_their_settings(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    expires = datetime(2099, 1, 1, tzinfo=UTC)
    s.invites.issue(
        beta_group="developer",
        max_uses=3,
        expires_at=expires,
        note="contract",
        codes=["contract-ab cd"],
    )
    assert probe.invite("CONTRACTABCD") == ("developer", 3, 0, expires, "contract")


def test_issuing_a_duplicate_code_is_refused(store: tuple[Store, Probe]) -> None:
    s, _ = store
    expires = datetime(2099, 1, 1, tzinfo=UTC)
    s.invites.issue(
        beta_group="student",
        max_uses=1,
        expires_at=expires,
        note=None,
        codes=["DUPCODE123"],
    )
    with pytest.raises(DuplicateInviteCode):
        s.invites.issue(
            beta_group="student",
            max_uses=1,
            expires_at=expires,
            note=None,
            codes=["dupcode123"],
        )


def test_purge_removes_only_guests_without_a_live_session(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    # A past `now`: every real guest in a shared database has a session expiring after
    # it, so the purge neither counts nor locks rows other tests are using.
    now = datetime(2000, 6, 1, tzinfo=UTC)
    probe.add_user("guest-stale", True, [datetime(2000, 5, 1, tzinfo=UTC)])
    probe.add_user("guest-none", True, [])
    probe.add_user(
        "guest-live",
        True,
        [datetime(2000, 5, 1, tzinfo=UTC), datetime(2000, 6, 2, tzinfo=UTC)],
    )
    probe.add_user("account-stale", False, [datetime(2000, 5, 1, tzinfo=UTC)])
    purged = s.users.purge_inactive_guests(now)
    assert probe.user_ids() == {"guest-live", "account-stale"}
    # A shared database can hold other session-less guests (a signed-out local one, or
    # one another test is creating), so only the fake can promise the exact count.
    assert purged == 2 if isinstance(s, InMemoryStore) else purged >= 2


# Q-P1-29: admin is granted per person, by email, to accounts only.
def test_capabilities_are_granted_and_revoked_by_email(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.add_user("acct-grant", False, [])
    probe.add_user("guest-grant", True, [])
    account = email_of("acct-grant")
    assert s.grants.grant(account, "admin.review") == "granted"
    # Granting twice is fine, and emails match whatever their case or spacing.
    assert s.grants.grant(f" {account.upper()} ", "admin.review") == "granted"
    assert probe.capabilities("acct-grant") == {"admin.review"}
    assert s.grants.revoke(account, "admin.review") == "revoked"
    assert probe.capabilities("acct-grant") == set()
    assert s.grants.revoke(account, "admin.review") == "not_granted"


def test_a_capability_a_plan_limits_cannot_be_granted(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.add_user("acct-limited", False, [])
    assert s.grants.grant(email_of("acct-limited"), "ai.notes.daily") == "limited"
    assert probe.capabilities("acct-limited") == set()


def test_guests_and_unknown_emails_cannot_be_granted(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.add_user("guest-grant2", True, [])
    assert s.grants.grant(email_of("guest-grant2"), "admin.review") == "no_account"
    assert probe.capabilities("guest-grant2") == set()
    nobody = "nobody@contract.example.test"
    assert s.grants.grant(nobody, "admin.review") == "no_account"
    assert s.grants.revoke(nobody, "admin.review") == "no_account"


def usage(user_id: str | None, cost: str, at: datetime) -> Usage:
    return Usage(
        user_id=user_id,
        feature="tagging",
        provider="openrouter",
        model="test-model",
        input_tokens=10,
        output_tokens=5,
        cost_usd=Decimal(cost),
        occurred_at=at,
    )


# OPS-4, Q-P1-23: spend per user and offline spend, per UTC day.
def test_ai_spend_is_summed_per_user_and_per_utc_day(
    ledger: tuple[AiLedger, Probe],
) -> None:
    ai, probe = ledger
    probe.add_user("ai-user", False, [])
    # A day far ahead, so rows other runs commit can't land in it.
    day = date(2099, 1, 2)
    ai.record(usage("ai-user", "0.10", datetime(2099, 1, 2, 0, 5, tzinfo=UTC)))
    ai.record(usage("ai-user", "0.05", datetime(2099, 1, 1, 23, 59, tzinfo=UTC)))
    ai.record(usage(None, "1.25", datetime(2099, 1, 2, 12, 0, tzinfo=UTC)))
    assert ai.spent_usd("ai-user", day) == Decimal("0.10")
    assert ai.spent_usd(None, day) == Decimal("1.25")
    assert ai.spent_usd("ai-user", date(2099, 1, 3)) == Decimal("0")


def test_a_deleted_users_spend_never_counts_as_offline_spend(
    ledger: tuple[AiLedger, Probe],
) -> None:
    ai, probe = ledger
    probe.add_user("ai-gone", False, [])
    ai.record(usage("ai-gone", "0.40", datetime(2099, 1, 4, 9, 0, tzinfo=UTC)))
    probe.delete_user("ai-gone")
    assert ai.spent_usd(None, date(2099, 1, 4)) == Decimal("0")


def test_ai_budgets_come_from_the_plan_and_the_global_row(
    ledger: tuple[AiLedger, Probe],
) -> None:
    ai, probe = ledger
    probe.add_user("ai-user2", False, [])
    assert ai.daily_budget_cents("ai-user2") == 50
    assert ai.daily_budget_cents(None) == 500
    # No plan grants an unknown user anything, so no AI either.
    assert ai.daily_budget_cents("nobody") == 0


def seed(
    name: str,
    *,
    rights_profile: RightsProfile = "full_text_internal",
    moments_enabled: bool = True,
    paywalled: bool = False,
    quality_score: int | None = None,
    topics: tuple[str, ...] = ("backend",),
) -> SourceSettings:
    return SourceSettings(
        name=name,
        homepage=None,
        feed_url=f"https://{name}.example.test/feed",
        rights_profile=rights_profile,
        moments_enabled=moments_enabled,
        paywalled=paywalled,
        quality_score=quality_score,
        topics=topics,
    )


# P1-W2-S01: the seed file is the truth for which sources exist and how they're set.
def test_syncing_the_seed_list_is_idempotent(store: tuple[Store, Probe]) -> None:
    s, probe = store
    seeds = [seed("sync-a", quality_score=4), seed("sync-b", paywalled=True)]
    first = s.sources.sync(seeds)
    assert (first.added, first.updated, first.unchanged) == (2, 0, 0)
    assert probe.source_state("sync-a") == (
        True,
        "https://sync-a.example.test/feed",
        "full_text_internal",
        True,
        False,
        4,
        ("backend",),
    )
    again = s.sources.sync(seeds)
    assert (again.added, again.updated, again.unchanged, again.deactivated) == (
        0,
        0,
        2,
        0,
    )


def test_a_source_removed_from_the_list_is_deactivated_and_keeps_its_items(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("sync-keep"), seed("sync-drop")])
    source_id = s.sources.upsert(
        name="sync-drop",
        feed_url="https://sync-drop.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(
        source_id, entry("dropped-item"), keep_excerpt=False
    )
    result = s.sources.sync([seed("sync-keep")])
    assert result.deactivated >= 1
    state = probe.source_state("sync-drop")
    assert state is not None and state[0] is False
    assert probe.has_item(item)
    # Back in the file, back on.
    s.sources.sync([seed("sync-keep"), seed("sync-drop")])
    state = probe.source_state("sync-drop")
    assert state is not None and state[0] is True


def test_a_changed_seed_updates_its_source(store: tuple[Store, Probe]) -> None:
    s, probe = store
    s.sources.sync([seed("sync-edit")])
    result = s.sources.sync(
        [seed("sync-edit", quality_score=2, topics=("databases",), paywalled=True)]
    )
    assert (result.added, result.updated) == (0, 1)
    state = probe.source_state("sync-edit")
    assert state is not None
    assert state[4:] == (True, 2, ("databases",))


def test_lowering_a_profile_through_sync_purges_stored_text(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("sync-lower")])
    source_id = s.sources.upsert(
        name="sync-lower",
        feed_url="https://sync-lower.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(source_id, entry("lower-item"), keep_excerpt=False)
    s.items.store_full_text(item, "body")
    s.sources.sync(
        [seed("sync-lower", rights_profile="metadata_only", moments_enabled=False)]
    )
    assert probe.full_text(item) is None


def test_a_renamed_source_with_the_same_feed_keeps_its_row(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("sync-old")])
    source_id = s.sources.upsert(
        name="sync-old",
        feed_url="https://sync-old.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(
        source_id, entry("renamed-item"), keep_excerpt=False
    )
    renamed = replace(seed("sync-new"), feed_url="https://sync-old.example.test/feed")
    result = s.sources.sync([renamed])
    assert (result.added, result.updated) == (0, 1)
    assert probe.source_state("sync-old") is None
    state = probe.source_state("sync-new")
    assert state is not None and state[0] is True
    assert probe.has_item(item)


def test_a_source_ingest_one_made_is_adopted_by_its_feed(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.upsert(
        name="adhoc-name",
        feed_url="https://adopted.example.test/feed",
        rights_profile="metadata_only",
        homepage=None,
    )
    adopted = replace(seed("adopted"), feed_url="https://adopted.example.test/feed")
    assert s.sources.sync([adopted]).updated == 1
    assert probe.source_state("adhoc-name") is None


def test_upsert_reactivates_a_source(store: tuple[Store, Probe]) -> None:
    s, probe = store
    s.sources.sync([seed("sync-off")])
    s.sources.sync([seed("sync-other")])
    s.sources.upsert(
        name="sync-off",
        feed_url="https://sync-off.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    state = probe.source_state("sync-off")
    assert state is not None and state[0] is True


def test_switching_moments_off_through_sync_purges_moments(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("sync-moments")])
    source_id = s.sources.upsert(
        name="sync-moments",
        feed_url="https://sync-moments.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    probe.enable_moments(source_id)
    item = s.items.upsert_from_feed(source_id, entry("moment-item"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "m0")])
    # Same full-text profile, moments switched off in the same update.
    s.sources.sync([seed("sync-moments", moments_enabled=False, quality_score=3)])
    assert probe.moments(item) == []


def test_active_ids_lists_only_sources_still_in_the_seed_list(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    s.sources.sync([seed("act-a"), seed("act-b")])
    s.sources.sync([seed("act-a")])  # act-b removed: inactive
    feeds = {
        record.feed_url
        for record in (s.sources.get(i) for i in s.sources.active_ids())
        if record is not None
    }
    assert "https://act-a.example.test/feed" in feeds
    assert "https://act-b.example.test/feed" not in feeds


# W2-S02b: what the pipeline's stages read.
def test_what_the_fetch_and_segment_stages_read(store: tuple[Store, Probe]) -> None:
    s, _ = store
    source_id = s.sources.upsert(
        name="stage-reads",
        feed_url="https://stage-reads.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(source_id, entry("stage"), keep_excerpt=False)
    fetch = s.items.for_fetch(item)
    assert fetch is not None
    assert fetch.rights_profile == "full_text_internal"
    assert fetch.canonical_url == "https://contract.example.test/stage"
    assert s.items.for_fetch(10**9) is None
    assert s.items.has_body(item) is False
    s.items.store_full_text(item, "body")
    assert s.items.has_body(item) is True
    assert s.moments.exist(item) is False


def test_fetch_validators_are_kept_per_url(store: tuple[Store, Probe]) -> None:
    s, _ = store
    url = "https://validators.example.test/feed"
    assert s.validators.get(url) is None
    s.validators.put(url, Validators('"v1"', None))
    assert s.validators.get(url) == Validators('"v1"', None)
    s.validators.put(url, Validators(None, "Mon, 26 Oct 2026 01:00:00 GMT"))
    assert s.validators.get(url) == Validators(None, "Mon, 26 Oct 2026 01:00:00 GMT")
    s.validators.put(url, None)  # the server stopped sending them
    assert s.validators.get(url) is None


# ING-1 normalize (Q-P1-08): duplicates link to the earliest-published item.
def dup_source(
    s: Store, name: str, profile: RightsProfile = "full_text_internal"
) -> int:
    return s.sources.upsert(
        name=f"dup-{name}",
        feed_url=f"https://dup-{name}.example.test/feed.xml",
        rights_profile=profile,
        homepage=None,
    )


def dup_item(
    s: Store,
    source_id: int,
    guid: str,
    day: int,
    url: str | None = None,
    title: str | None = None,
    author: str | None = None,
) -> int:
    return s.items.upsert_from_feed(
        source_id,
        FeedEntry(
            guid=f"contract-dup-{guid}",
            link=url or f"https://dup.example.test/{guid}",
            title=title or f"Unique title {guid}",
            author=author,
            published_at=datetime(2099, 11, day, tzinfo=UTC),
            updated_at=None,
            summary=None,
        ),
        keep_excerpt=False,
    )


A_HASH = 0x0F0F_0F0F_0F0F_0F0F
NEAR_A = A_HASH ^ 0b101  # two bits away
FAR_FROM_A = A_HASH ^ 0xFFFF


def test_the_same_canonical_url_on_two_sources_is_one_article(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    first = dup_item(
        s, dup_source(s, "a"), "x1", 2, url="https://dup.example.test/same"
    )
    later = dup_item(
        s, dup_source(s, "b"), "x2", 5, url="https://dup.example.test/same"
    )
    assert s.items.link_duplicates(later) == first
    assert (probe.primary_of(first), probe.primary_of(later)) == (None, first)


def test_near_simhashes_link_and_far_ones_do_not(store: tuple[Store, Probe]) -> None:
    s, probe = store
    a = dup_item(s, dup_source(s, "a"), "s1", 2)
    near = dup_item(s, dup_source(s, "b"), "s2", 3)
    far = dup_item(s, dup_source(s, "c"), "s3", 4)
    for item, value in ((a, A_HASH), (near, NEAR_A), (far, FAR_FROM_A)):
        s.items.store_full_text(item, "body")
        s.items.set_simhash(item, value)
        s.items.link_duplicates(item)
    assert (probe.primary_of(near), probe.primary_of(far)) == (a, None)


def test_without_body_text_title_author_and_date_decide(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a = dup_source(s, "a", "metadata_only")
    b = dup_source(s, "b", "metadata_only")
    first = dup_item(s, a, "m1", 2, title="Queues  In Depth", author="Ann")
    same = dup_item(s, b, "m2", 2, title="queues in depth", author="Ann")
    other_day = dup_item(s, b, "m3", 9, title="Queues in depth", author="Ann")
    for item in (first, same, other_day):
        s.items.link_duplicates(item)
    assert (probe.primary_of(same), probe.primary_of(other_day)) == (first, None)


def test_two_bodies_far_apart_are_not_duplicates_despite_matching_metadata(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a = dup_item(s, dup_source(s, "a"), "f1", 2, title="Weekly notes", author="Bo")
    b = dup_item(s, dup_source(s, "b"), "f2", 2, title="Weekly notes", author="Bo")
    for item, value in ((a, A_HASH), (b, FAR_FROM_A)):
        s.items.store_full_text(item, "body")
        s.items.set_simhash(item, value)
        s.items.link_duplicates(item)
    assert probe.primary_of(b) is None


def test_an_earlier_newcomer_becomes_the_primary(store: tuple[Store, Probe]) -> None:
    s, probe = store
    url = "https://dup.example.test/backfilled"
    later = dup_item(s, dup_source(s, "a"), "e1", 20, url=url)
    middle = dup_item(s, dup_source(s, "b"), "e2", 10, url=url)
    s.items.link_duplicates(middle)
    earliest = dup_item(s, dup_source(s, "c"), "e3", 1, url=url)
    assert s.items.link_duplicates(earliest) == earliest
    assert [probe.primary_of(i) for i in (earliest, middle, later)] == [
        None,
        earliest,
        earliest,
    ]


def test_a_simhash_needs_full_text_rights_and_goes_when_they_do(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    excerpt = dup_item(s, dup_source(s, "ex", "excerpt"), "r1", 2)
    with pytest.raises(RightsViolation):
        s.items.set_simhash(excerpt, A_HASH)
    sid = dup_source(s, "lowered")
    item = dup_item(s, sid, "r2", 2)
    s.items.store_full_text(item, "body")
    s.items.set_simhash(item, A_HASH)
    s.sources.upsert(
        name="dup-lowered",
        feed_url="https://dup-lowered.example.test/feed.xml",
        rights_profile="metadata_only",
        homepage=None,
    )
    assert probe.simhash(item) is None


def test_a_poll_keeps_the_canonical_url_the_fetch_found(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    sid = dup_source(s, "a")
    item = dup_item(s, sid, "c1", 2, url="https://dup.example.test/c1?page=1")
    s.items.set_canonical(item, "https://dup.example.test/c1")
    dup_item(s, sid, "c1", 2, url="https://dup.example.test/c1?page=1")  # next poll
    fetch = s.items.for_fetch(item)
    assert fetch is not None
    assert fetch.canonical_url == "https://dup.example.test/c1"


def test_a_missing_author_or_date_never_matches_on_metadata(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a = dup_source(s, "a", "metadata_only")
    b = dup_source(s, "b", "metadata_only")
    first = dup_item(s, a, "n1", 2, title="Weekly links")
    unnamed = dup_item(s, b, "n2", 2, title="Weekly links")
    one_named = dup_item(s, b, "n3", 2, title="Weekly links", author="Cy")
    for item in (first, unnamed, one_named):
        s.items.link_duplicates(item)
    assert (probe.primary_of(unnamed), probe.primary_of(one_named)) == (None, None)
    undated_a = s.items.upsert_from_feed(a, undated_entry("u1"), keep_excerpt=False)
    undated_b = s.items.upsert_from_feed(b, undated_entry("u2"), keep_excerpt=False)
    s.items.link_duplicates(undated_b)
    assert (probe.primary_of(undated_a), probe.primary_of(undated_b)) == (None, None)


def undated_entry(guid: str) -> FeedEntry:
    return FeedEntry(
        guid=f"contract-dup-{guid}",
        link=f"https://dup.example.test/{guid}",
        title="Undated post",
        author="Di",
        published_at=None,
        updated_at=None,
        summary=None,
    )


def test_titles_match_across_ascii_spacing_and_case_in_every_store(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a = dup_source(s, "a", "metadata_only")
    b = dup_source(s, "b", "metadata_only")
    nbsp = dup_item(s, a, "w1", 2, title="Queues\u00a0in depth", author="Ann")
    spaced = dup_item(s, a, "w2", 2, title="Queues in depth", author="Ann")
    tabbed = dup_item(s, b, "w3", 2, title="  queues\tin  DEPTH ", author="ann")
    for item in (nbsp, spaced, tabbed):
        s.items.link_duplicates(item)
    # A no-break space is not whitespace to Postgres; the fake must agree.
    assert probe.primary_of(nbsp) is None
    assert probe.primary_of(tabbed) == spaced


def test_an_item_bridging_two_groups_merges_them(store: tuple[Store, Probe]) -> None:
    s, probe = store
    x_url, y_url = "https://dup.example.test/gx", "https://dup.example.test/gy"
    x1 = dup_item(s, dup_source(s, "a"), "g1", 1, url=x_url)
    x2 = dup_item(s, dup_source(s, "b"), "g2", 5, url=x_url)
    y1 = dup_item(
        s, dup_source(s, "c"), "g3", 3, url=y_url, title="Bridge", author="Ed"
    )
    y2 = dup_item(s, dup_source(s, "d"), "g4", 6, url=y_url)
    s.items.link_duplicates(x2)
    s.items.link_duplicates(y2)
    assert probe.primary_of(y2) == y1
    # A metadata-only listing with x's link and y1's title, author and day.
    listing = dup_source(s, "e", "metadata_only")
    bridge = dup_item(s, listing, "g5", 3, url=x_url, title="Bridge", author="Ed")
    assert s.items.link_duplicates(bridge) == x1
    assert [probe.primary_of(i) for i in (x1, x2, y1, y2, bridge)] == [
        None,
        x1,
        x1,
        x1,
        x1,
    ]


# ING-3 adaptive polling (P1-W2-S03).
def test_claiming_due_sources_pushes_each_to_its_next_turn(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    now = datetime(2099, 1, 1, 12, tzinfo=UTC)
    due = dup_source(s, "due")
    later = dup_source(s, "later")
    # Polled an hour ago at a 2-hour interval: due an hour from now.
    s.sources.record_poll(later, timedelta(hours=2), now - timedelta(hours=1))
    claimed = s.sources.claim_due(now)
    assert due in claimed and later not in claimed
    assert due not in s.sources.claim_due(now + timedelta(minutes=5))
    record = s.sources.get(due)
    assert record is not None
    # Claimed for one interval (an hour): a lost discover is polled again after it,
    # and the source scheduled for that hour comes due with it.
    assert record.poll_interval == timedelta(hours=1)
    again = s.sources.claim_due(now + record.poll_interval)
    assert due in again and later in again


def test_a_new_source_is_due_at_once_with_the_starting_interval(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    sid = dup_source(s, "new")
    record = s.sources.get(sid)
    assert record is not None and record.poll_interval == timedelta(hours=1)
    assert sid in s.sources.claim_due(datetime(2099, 1, 1, tzinfo=UTC))


def test_an_inactive_source_is_never_claimed(store: tuple[Store, Probe]) -> None:
    s, _ = store
    sid = dup_source(s, "kept")
    s.sources.sync([])  # removed from the seed list
    assert sid not in s.sources.claim_due(datetime(2099, 1, 1, tzinfo=UTC))


def test_known_guids_tell_new_entries_from_seen_ones(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    sid = dup_source(s, "guids")
    dup_item(s, sid, "seen", 2)
    other = dup_source(s, "other")
    dup_item(s, other, "elsewhere", 2)
    assert s.items.known_guids(
        sid, ["contract-dup-seen", "contract-dup-new", "contract-dup-elsewhere"]
    ) == {"contract-dup-seen"}


# DB-2 concept graph (P1-W3-S01, Q-P1-04).
def graph(version: int, body: str) -> ConceptGraph:
    return parse_concepts(f"version: {version}\nconcepts:\n{body}", "c.yaml")


CHAIN = """
  - {slug: cg-replication, name: Replication, topic: distributed-systems}
  - {slug: cg-lag, name: Lag, topic: distributed-systems,
     prerequisites: [cg-replication]}
  - {slug: cg-ryw, name: RYW, topic: distributed-systems, prerequisites: [cg-lag]}
  - {slug: cg-quorum, name: Quorum, topic: distributed-systems, related: [cg-lag]}
"""


def test_a_concepts_aliases_are_stored_and_read_back(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(
        s,
        graph(
            1,
            "  - {slug: cg-wal, name: Write-ahead log, topic: databases, "
            "aliases: [WAL, write ahead log]}\n",
        ),
    )
    state = s.concepts.state()
    assert state is not None
    assert state.concepts[0].aliases == ("WAL", "write ahead log")
    found = s.concepts.get("cg-wal")
    assert found is not None and found.aliases == ("WAL", "write ahead log")


def test_concept_vectors_are_stored_per_model_with_their_texts_hash(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    vector = [0.0] * 1023 + [1.0]
    s.concepts.save_vector("cg-lag", "voyage-x", "h1", vector)
    s.concepts.save_vector("cg-lag", "voyage-x", "h2", vector)  # the text changed
    assert s.concepts.vectors("voyage-x") == {"cg-lag": ("h2", vector)}
    assert s.concepts.vectors("other-model") == {}
    with pytest.raises(ValueError, match="no concept"):
        s.concepts.save_vector("cg-nobody", "voyage-x", "h", vector)


# Tagging v3 (2026-10-27): a decision model's raw answers, kept so cut-offs can be
# retuned without asking again, with the hash of what was asked about.
def test_decisions_are_kept_per_moment_and_article_with_their_hashes(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("decided"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "a"), moment(1, "b")])
    first = probe.moments(item)[0][0]
    model = "perplexity/pplx-decider-v1.2"
    assert s.decisions.moment_hashes(item, model) == {}
    s.decisions.save_moment(first, model, "h0", 1.2, {"cg-lag": 0.9, "cg-ryw": 0.1})
    # Asked again after its text changed: the new answers replace the old ones.
    s.decisions.save_moment(first, model, "h1", 0.4, {"cg-lag": 0.25})
    s.decisions.save_item(item, model, "t1", 0.7, {"cg-ryw": 0.8})
    assert s.decisions.moment_hashes(item, model) == {first: "h1"}
    assert s.decisions.item_hash(item, model) == "t1"
    got = s.decisions.read(item, model)
    assert got.moments == {first: (0.4, {"cg-lag": 0.25})}
    assert (got.item, got.item_difficulty) == ({"cg-ryw": 0.8}, 0.7)
    assert s.decisions.read(item, "another/model") == ItemDecisions({}, {})
    with pytest.raises(ValueError, match="no concept"):
        s.decisions.save_moment(first, model, "h2", 1.0, {"cg-nobody": 0.5})


def test_a_loaded_graph_answers_recursive_prerequisites(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    result = sync_concepts(s, graph(1, CHAIN))
    assert (result.added, result.retired) == (4, 0)
    assert s.concepts.prerequisites("cg-ryw") == {"cg-lag", "cg-replication"}
    assert s.concepts.prerequisites("cg-replication") == set()
    # "related to" is not a prerequisite.
    assert s.concepts.prerequisites("cg-quorum") == set()


def test_loading_the_same_file_again_changes_nothing(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    assert sync_concepts(s, graph(1, CHAIN)).changed is False


def test_a_changed_file_must_bump_its_version(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    renamed = CHAIN.replace("name: RYW", "name: Read your writes")
    with pytest.raises(ConceptSeedError, match="version"):
        sync_concepts(s, graph(1, renamed))
    assert sync_concepts(s, graph(2, renamed)).updated == 1


def test_a_concept_dropped_from_the_file_is_retired_and_stays_readable(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    without_lag = """
  - {slug: cg-replication, name: Replication, topic: distributed-systems}
  - {slug: cg-ryw, name: RYW, topic: distributed-systems,
     prerequisites: [cg-replication]}
  - {slug: cg-quorum, name: Quorum, topic: distributed-systems}
"""
    assert sync_concepts(s, graph(2, without_lag)).retired == 1
    lag = s.concepts.get("cg-lag")
    assert lag is not None and lag.retired and lag.name == "Lag"
    assert s.concepts.prerequisites("cg-ryw") == {"cg-replication"}


def test_a_merged_concept_points_at_its_replacement(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.reset_concepts()
    body = (
        CHAIN
        + "  - {slug: cg-old-lag, name: Old, topic: backend, merged_into: cg-lag}\n"
    )
    sync_concepts(s, graph(1, body))
    old = s.concepts.get("cg-old-lag")
    assert old is not None and (old.retired, old.merged_into) == (True, "cg-lag")


def test_the_store_refuses_a_prerequisite_cycle_the_parser_did_not_see(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    current = s.concepts.state()
    assert current is not None
    closing: set[ConceptEdge] = {("cg-ryw", "cg-replication", "prerequisite_of")}
    looped = ConceptGraph(
        2,
        current.concepts,
        current.edges | closing,
    )
    with pytest.raises(ConceptCycleError):
        s.concepts.apply(looped)


def test_a_retired_or_merged_concept_can_come_back(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.reset_concepts()
    old_lag = "{slug: cg-old-lag, name: Old, topic: backend, merged_into: cg-lag}"
    sync_concepts(s, graph(1, CHAIN + f"  - {old_lag}\n"))
    revived = CHAIN + "  - {slug: cg-old-lag, name: Old, topic: backend}\n"
    sync_concepts(s, graph(2, revived))
    back = s.concepts.get("cg-old-lag")
    assert back is not None and (back.retired, back.merged_into) == (False, None)


def test_an_older_file_with_unchanged_content_is_a_no_op(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(3, CHAIN))
    assert sync_concepts(s, graph(1, CHAIN)).changed is False


def test_postgres_refuses_deleting_a_concept_and_unknown_edge_types(
    conn: psycopg.Connection,
) -> None:
    # Tags and learner state reference concepts (W3-S02 on): they must never dangle.
    PostgresProbe(conn).reset_concepts()
    sync_concepts(PostgresStore(conn), graph(1, CHAIN))
    with pytest.raises(psycopg.errors.RaiseException), conn.transaction():
        conn.execute("delete from concept where slug = 'cg-lag'")
    with pytest.raises(psycopg.errors.InvalidTextRepresentation), conn.transaction():
        conn.execute(
            "insert into concept_edge (from_id, to_id, type) select a.id, b.id, "
            "'depends_on' from concept a, concept b "
            "where a.slug = 'cg-lag' and b.slug = 'cg-ryw'"
        )


# AI-3 tags (P1-W3-S02): stored apart from source text, readable after a retirement.
def test_tags_are_saved_replaced_and_survive_retiring_their_concept(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("tags"), keep_excerpt=False)
    s.items.store_full_text(item, "Intro\nLag\nbody")
    s.moments.replace(item, [moment(0, "intro"), moment(1, "Lag")])
    tag_input = s.tags.input(item)
    assert tag_input is not None and tag_input.full_text == "Intro\nLag\nbody"
    assert [m.ordinal for m in tag_input.moments] == [0, 1]
    second = tag_input.moments[1].id
    result = TagResult(
        Tags("intermediate", frozenset({"cg-lag", "cg-replication"})),
        {second: Tags("advanced", frozenset({"cg-lag"}))},
    )
    s.tags.save(item, result, "small-model", 1)
    assert s.tags.version(item) == 1
    assert s.tags.for_item(item) == (result.item, {1: result.moments[second]})
    # Retire cg-lag: its tags still read back (tags never dangle, Q-P1-04).
    without_lag = (
        CHAIN.replace(
            "  - {slug: cg-lag, name: Lag, topic: distributed-systems,\n"
            "     prerequisites: [cg-replication]}\n",
            "",
        )
        .replace("prerequisites: [cg-lag]", "prerequisites: [cg-replication]")
        .replace(", related: [cg-lag]", "")
    )
    sync_concepts(s, graph(2, without_lag))
    assert s.tags.for_item(item)[0] == result.item
    # A new prompt version replaces the tags.
    again = TagResult(Tags("beginner", frozenset({"cg-replication"})), {})
    s.tags.save(item, again, "small-model", 2)
    assert s.tags.for_item(item) == (again.item, {})
    assert s.tags.version(item) == 2


def test_tag_reads_respect_rights_and_saves_refuse_foreign_moments(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("rights"), keep_excerpt=False)
    other = s.items.upsert_from_feed(sid, entry("rights-other"), keep_excerpt=False)
    s.items.store_full_text(item, "body")
    s.moments.replace(other, [moment(0, "theirs")])
    assert s.tags.find("https://contract.example.test/rights") == item
    assert s.tags.needs_tagging(item, 1) is True
    theirs = probe.moments(other)[0][0]
    foreign = TagResult(
        Tags("beginner", frozenset()), {theirs: Tags("beginner", frozenset())}
    )
    with pytest.raises(ValueError, match="not item"):
        s.tags.save(item, foreign, "m", 1)
    s.tags.save(item, TagResult(Tags("beginner", frozenset()), {}), "m", 1)
    assert s.tags.needs_tagging(item, 1) is False
    assert s.tags.needs_tagging(item, 2) is True
    s.tags.clear(item)
    assert s.tags.version(item) is None
    # Lowered to excerpt: the stored body is purged and never read for tagging.
    change_profile(s, "full_text_internal", "excerpt")
    tag_input = s.tags.input(item)
    assert tag_input is not None and tag_input.full_text is None


# DB-3 embeddings (P1-W3-S04): one query filters by rights, source and difficulty.
def unit(*first: float) -> list[float]:
    return [*first, *([0.0] * (1024 - len(first)))]


def test_similar_moments_filter_by_rights_source_and_difficulty(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a, b = dup_source(s, "emb-a"), dup_source(s, "emb-b")
    for sid in (a, b):
        probe.enable_moments(sid)
    item_a = dup_item(s, a, "emb1", 2)
    item_b = dup_item(s, b, "emb2", 3)
    a1_row = replace(moment(1, "a1"), link_type="anchor")  # starts at heading "a1"
    s.moments.replace(item_a, [moment(0, "a0"), a1_row])
    s.moments.replace(item_b, [moment(0, "b0")])
    a0, a1 = (m[0] for m in probe.moments(item_a))
    (b0,) = (m[0] for m in probe.moments(item_b))
    assert s.embeddings.missing(item_a, "voyage-3.5") is True
    s.embeddings.save(item_a, {a0: unit(1, 0)}, "voyage-3.5", complete=False)
    # Part way (a budget stop): still missing, and the done moment is skipped next.
    assert s.embeddings.missing(item_a, "voyage-3.5") is True
    assert s.embeddings.done(item_a, "voyage-3.5") == {a0}
    s.embeddings.save(item_a, {a1: unit(0.7, 0.7)}, "voyage-3.5", complete=True)
    s.embeddings.save(item_b, {b0: unit(0.9, 0.1)}, "voyage-3.5", complete=True)
    assert s.embeddings.missing(item_a, "voyage-3.5") is False
    assert s.embeddings.missing(item_a, "voyage-3-large") is True
    s.tags.save(
        item_a,
        TagResult(
            Tags("beginner", frozenset()),
            {a0: Tags("advanced", frozenset()), a1: Tags("beginner", frozenset())},
        ),
        "m",
        1,
    )
    query = unit(1, 0)
    ours = {a0, a1, b0}
    hits = [h.moment_id for h in s.embeddings.similar(query, 50) if h.moment_id in ours]
    assert hits == [a0, b0, a1]  # nearest first
    # Vectors from another model aren't comparable, so they never match (P1-W4-S02).
    other = s.embeddings.similar(query, 50, model="voyage-3-large")
    assert not [h for h in other if h.moment_id in ours]
    assert s.embeddings.vectors_of_item(item_b, "voyage-3.5")[b0][:2] == [0.9, 0.1]
    by_source = s.embeddings.similar(query, 50, source_ids=[b])
    assert [h.moment_id for h in by_source] == [b0]
    by_level = s.embeddings.similar(query, 50, difficulties=["beginner"])
    assert [h.moment_id for h in by_level if h.moment_id in ours] == [a1]
    # A broken link (P1-W6-S03) is never offered as similar; it comes back once fixed.
    s.items.set_link_broken(item_b, datetime(2026, 10, 26, tzinfo=UTC))
    assert b0 not in {h.moment_id for h in s.embeddings.similar(query, 50)}
    s.items.set_link_broken(item_b, None)
    assert b0 in {h.moment_id for h in s.embeddings.similar(query, 50)}
    # An admin's correction of a1's level wins (P1-W3-S05).
    probe.override_level(item_a, "a1", "advanced")
    by_level = s.embeddings.similar(query, 50, difficulties=["beginner"])
    assert [h.moment_id for h in by_level if h.moment_id in ours] == []
    # Lowering a source's rights removes its moments, and so their vectors.
    s.sources.upsert(
        name="dup-emb-b",
        feed_url="https://dup-emb-b.example.test/feed.xml",
        rights_profile="excerpt",
        homepage=None,
    )
    assert s.embeddings.similar(query, 50, source_ids=[b]) == []


def test_saving_vectors_for_another_items_moments_is_refused(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = dup_source(s, "emb-c")
    probe.enable_moments(sid)
    mine, theirs = dup_item(s, sid, "emb3", 2), dup_item(s, sid, "emb4", 2)
    s.moments.replace(theirs, [moment(0, "t0")])
    (t0,) = (m[0] for m in probe.moments(theirs))
    with pytest.raises(ValueError, match="not item"):
        s.embeddings.save(mine, {t0: unit(1)}, "voyage-3.5", complete=True)


def test_a_duplicate_or_momentless_item_never_needs_embedding(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    url = "https://dup.example.test/emb-dup"
    a, b = dup_source(s, "emb-d1"), dup_source(s, "emb-d2")
    probe.enable_moments(a)
    probe.enable_moments(b)
    primary, copy = dup_item(s, a, "ed1", 1, url=url), dup_item(s, b, "ed2", 2, url=url)
    assert s.embeddings.missing(primary, "voyage-3.5") is False  # no moments yet
    s.moments.replace(primary, [moment(0, "p0")])
    s.moments.replace(copy, [moment(0, "c0")])
    s.items.link_duplicates(copy)
    assert s.embeddings.missing(primary, "voyage-3.5") is True
    assert s.embeddings.missing(copy, "voyage-3.5") is False


# ING-6 admin review (P1-W3-S05): segmentation reads the admin's boundaries.
def test_the_boundary_override_is_read_for_segmentation(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    item = s.items.upsert_from_feed(source(s), entry("bounds"), keep_excerpt=False)
    assert s.items.boundary_override(item) is None
    probe.set_boundaries(item, ["Setup", "Recovery"])
    assert s.items.boundary_override(item) == ["Setup", "Recovery"]


def test_re_ingesting_leaves_the_admins_overrides_alone(
    conn: psycopg.Connection,
) -> None:
    # P1-W3-S05: tags and moments are redone on re-ingestion; overrides are not.
    s = PostgresStore(conn)
    sid = source(s)
    PostgresProbe(conn).enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("survive"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "intro"), moment(1, "Setup")])
    conn.execute(
        "insert into tag_override (content_item_id, heading, difficulty, concepts, "
        "updated_by) values (%s, 'Setup', 'advanced', '{}', 'admin')",
        (item,),
    )
    PostgresProbe(conn).set_boundaries(item, ["Setup"])
    s.tags.clear(item)
    s.embeddings.clear(item)
    s.moments.replace(item, [moment(0, "intro")])
    s.items.upsert_from_feed(sid, entry("survive"), keep_excerpt=False)
    rows = conn.execute(
        "select (select count(*) from tag_override where content_item_id = %s), "
        "(select count(*) from moment_boundary_override where content_item_id = %s)",
        (item, item),
    ).fetchone()
    assert rows == (1, 1)


# P1-W3-S06: an admin's moments switch survives a seed reload.
def test_an_admins_moments_switch_survives_seed_reloads(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("switched")])
    sid = s.sources.upsert(
        name="switched",
        feed_url="https://switched.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    item = s.items.upsert_from_feed(sid, entry("switched-item"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "sw0")])
    put_in_feed(s, probe, item)
    assert "sw0" in probe.feed_titles()
    probe.switch_moments_off(sid, True)
    assert probe.moments(item) == []  # purged: gone from the feed at once
    assert "sw0" not in probe.feed_titles()
    s.sources.sync([seed("switched")])  # unchanged file
    s.sources.sync([seed("switched", quality_score=4)])  # a changed one
    record = s.sources.get(sid)
    assert record is not None and record.moments_enabled is False
    probe.switch_moments_off(sid, False)  # back to what the seed file says
    record = s.sources.get(sid)
    assert record is not None and record.moments_enabled is True


def test_the_seed_file_and_the_admin_switch_both_have_to_allow_moments(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    s.sources.sync([seed("both")])
    sid = s.sources.upsert(
        name="both",
        feed_url="https://both.example.test/feed",
        rights_profile="full_text_internal",
        homepage=None,
    )
    probe.switch_moments_off(sid, True)
    s.sources.sync([seed("both", moments_enabled=False)])
    s.sources.sync([seed("both", moments_enabled=True)])  # seed back on: still off
    record = s.sources.get(sid)
    assert record is not None and record.moments_enabled is False
    probe.switch_moments_off(sid, False)
    s.sources.sync([seed("both", moments_enabled=False)])  # now the seed says off
    record = s.sources.get(sid)
    assert record is not None and record.moments_enabled is False


# REC-1 (P1-W4-S02): what ranking reads about a user.
# Learning goals (ADR-0015): explicit choices, with the owner-approved concept sets.
def test_goals_come_back_in_order_with_their_concept_sets(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    user = f"goals-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    probe.set_preferences(
        user, ["databases"], ["stay-sharp", "system-design-interviews"]
    )
    prefs = s.ranking.preferences(user)
    assert prefs is not None
    assert prefs.goals == ["system-design-interviews", "stay-sharp"]
    sets = s.ranking.goal_concepts(["system-design-interviews", "stay-sharp"])
    assert len(sets["system-design-interviews"]) == 24
    assert {"cap-theorem", "back-of-the-envelope-estimation", "caching"} <= sets[
        "system-design-interviews"
    ]
    assert sets.get("stay-sharp", frozenset()) == frozenset()  # no boost
    assert s.ranking.goal_concepts([]) == {}


def test_readers_return_preferences_feedback_and_topic_moments(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(
        s,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: rd-raft, name: Raft, topic: distributed-systems}\n"
            "  - {slug: rd-index, name: Index, topic: databases}\n",
            "c.yaml",
        ),
    )
    user = f"readers-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    assert s.ranking.preferences(user) is None
    probe.set_preferences(user, ["databases", "backend"])
    prefs = s.ranking.preferences(user)
    assert prefs is not None and prefs.topics == ["databases", "backend"]

    plain = dup_source(s, "rd-plain")  # seed topics: none
    probe.enable_moments(plain)
    by_tag = dup_item(s, plain, "rd1", 3)
    by_correction = dup_item(s, plain, "rd2", 2)
    off_topic = dup_item(s, plain, "rd3", 1)
    for item in (by_tag, by_correction, off_topic):
        s.moments.replace(item, [moment(0, f"rd-{item}")])
    s.tags.save(
        by_tag, TagResult(Tags("beginner", frozenset({"rd-index"})), {}), "m", 1
    )
    s.tags.save(
        by_correction, TagResult(Tags("beginner", frozenset({"rd-raft"})), {}), "m", 1
    )
    probe.correct_concepts(by_correction, ["rd-index"])  # the admin wins
    s.tags.save(
        off_topic, TagResult(Tags("beginner", frozenset({"rd-raft"})), {}), "m", 1
    )
    mine = {by_tag, by_correction, off_topic}
    rows = s.ranking.topic_moments(
        ["databases"], 1000, exclude_sources=set(), exclude_items=set()
    )
    assert [r.item_id for r in rows if r.item_id in mine] == [by_tag, by_correction]

    probe.give_feedback(user, by_tag, "not_interested")
    probe.give_feedback(user, by_correction, "more_like_this")
    probe.hide_source(user, plain)
    assert s.ranking.not_interested(user) == {by_tag}
    assert s.ranking.anchor_items(user, 5) == [by_correction]
    # Saved items anchor too (P1-W4-S07): after More like this, newest first, once.
    probe.save(user, off_topic)
    probe.save(user, by_correction)
    assert s.ranking.anchor_items(user, 5) == [by_correction, off_topic]
    assert s.ranking.anchor_items(user, 1) == [by_correction]
    assert s.ranking.hidden_sources(user) == {plain}
    rows = s.ranking.topic_moments(
        ["databases"], 1000, exclude_sources={plain}, exclude_items=set()
    )
    assert not [r for r in rows if r.item_id in mine]


def test_topic_moments_offer_the_shown_copy_of_active_sources_in_order(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(
        s,
        parse_concepts(
            "version: 1\nconcepts:\n  - {slug: tm-idx, name: I, topic: databases}\n",
            "c.yaml",
        ),
    )
    url = "https://dup.example.test/tm-shared"
    listing = dup_item(s, dup_source(s, "tm-list", "metadata_only"), "tm1", 1, url=url)
    full = dup_source(s, "tm-full")
    probe.enable_moments(full)
    original = dup_item(s, full, "tm2", 2, url=url)
    s.items.link_duplicates(original)
    newer = dup_item(s, full, "tm3", 5)
    emptied = dup_item(s, full, "tm4", 4)
    for item in (original, newer, emptied):
        s.moments.replace(item, [moment(0, f"tm-{item}a"), moment(1, f"tm-{item}b")])
        s.tags.save(
            item, TagResult(Tags("beginner", frozenset({"tm-idx"})), {}), "m", 1
        )
    probe.correct_concepts(emptied, [])  # an admin removed every concept: no match

    def offered(limit: int = 1000) -> list[tuple[int, int]]:
        rows = s.ranking.topic_moments(
            ["databases"], limit, exclude_sources=set(), exclude_items=set()
        )
        mine = {original, newer, emptied, listing}
        return [(r.item_id, r.moment_id) for r in rows if r.item_id in mine]

    got = offered()
    # The original (a full-text duplicate of an earlier metadata-only listing) is
    # offered; the listing has no moments. Newest item first, then reading order.
    assert [item for item, _ in got] == [newer, newer, original, original]
    assert got[0][1] < got[1][1]
    assert (
        s.ranking.topic_moments([], 10, exclude_sources=set(), exclude_items=set())
        == []
    )
    # A broken link (P1-W6-S03) is never offered, and comes back once it works.
    when = datetime(2026, 10, 26, tzinfo=UTC)
    s.items.set_link_broken(newer, when)
    assert [item for item, _ in offered()] == [original, original]
    s.items.set_link_broken(newer, None)
    assert [item for item, _ in offered()] == [newer, newer, original, original]
    s.sources.sync([seed("other-only")])  # tm-full leaves the seed list: inactive
    assert offered() == []


# REC-2 scoring inputs (P1-W4-S03).
def test_the_fakes_goal_concepts_match_the_migrations_seed(
    conn: psycopg.Connection,
) -> None:
    assert PostgresStore(conn).ranking.goal_concepts(list(LEARNING_GOALS)) == (
        GOAL_CONCEPTS
    )


def test_the_fakes_ranking_config_matches_the_migrations_seed(
    conn: psycopg.Connection,
) -> None:
    assert PostgresStore(conn).ranking.config() == RANKING_DEFAULTS


def test_moment_facts_and_feedback_for_scoring(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(
        s,
        parse_concepts(
            "version: 1\nconcepts:\n"
            "  - {slug: sf-a, name: A, topic: databases}\n"
            "  - {slug: sf-b, name: B, topic: databases}\n",
            "c.yaml",
        ),
    )
    user = f"scoring-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    sid = dup_source(s, "sf")
    probe.enable_moments(sid)
    item = dup_item(s, sid, "sf1", 7)
    disliked = dup_item(s, sid, "sf2", 6)
    heading_row = replace(moment(1, "Setup"), link_type="anchor")
    tuning_row = replace(moment(2, "Tuning"), link_type="anchor")
    s.moments.replace(item, [moment(0, "intro"), heading_row, tuning_row])
    s.moments.replace(disliked, [moment(0, "d0")])
    intro, setup, tuning = (m[0] for m in probe.moments(item))
    s.tags.save(
        item,
        TagResult(
            Tags("beginner", frozenset({"sf-a"})),
            {
                setup: Tags("advanced", frozenset()),
                tuning: Tags("beginner", frozenset()),
            },
        ),
        "m",
        1,
    )
    s.tags.save(disliked, TagResult(Tags("beginner", frozenset({"sf-b"})), {}), "m", 1)
    probe.override_level(item, "Setup", "intermediate")  # the admin wins
    facts = s.ranking.moment_facts([intro, setup, tuning])
    assert facts[setup].difficulty == "intermediate"
    assert facts[intro].difficulty == "beginner"  # no moment tag: the item's level
    assert facts[tuning].difficulty == "beginner"  # the model's moment tag
    assert facts[intro].concepts == frozenset({"sf-a"})
    assert facts[intro].minutes == 1 and facts[intro].item_id == item
    # Topics: the source's seed topics plus the topics of the item's concepts.
    assert facts[intro].topics == frozenset({"databases"})
    assert facts[intro].quality is None and facts[intro].source_id == sid
    assert facts[intro].published_at == datetime(2099, 11, 7, tzinfo=UTC)
    # Owner, 2026-10-26: an admin's item correction beats every model tag; only the
    # admin's own moment correction is more specific.
    probe.override_level(item, "", "advanced")
    facts = s.ranking.moment_facts([intro, setup, tuning])
    assert facts[tuning].difficulty == "advanced"
    assert facts[intro].difficulty == "advanced"
    assert facts[setup].difficulty == "intermediate"
    probe.give_feedback(user, item, "less_like_this")
    probe.give_feedback(user, disliked, "not_interested")
    assert s.ranking.less_liked(user) == {item}
    assert s.ranking.avoided_concepts(user) == frozenset({"sf-b"})
    probe.correct_concepts(disliked, ["sf-a"])  # an admin's correction replaces them
    assert s.ranking.avoided_concepts(user) == frozenset({"sf-a"})
    # A reset (P1-W4-S08): the item stays hidden, its concepts stop counting...
    probe.reset_inferred(user)
    assert s.ranking.avoided_concepts(user) == frozenset()
    assert s.ranking.not_interested(user) == {disliked}
    assert s.ranking.less_liked(user) == set()
    # ...until something is marked Not interested after it.
    later = dup_item(s, sid, "sf3", 5)
    s.tags.save(later, TagResult(Tags("beginner", frozenset({"sf-b"})), {}), "m", 1)
    probe.give_feedback(user, later, "not_interested")
    assert s.ranking.avoided_concepts(user) == frozenset({"sf-b"})


def put_in_feed(s: Store, probe: Probe, item_id: int) -> str:
    """A user whose feed holds the item's moments (feeds are per user, W4-S04)."""
    user = f"feed-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    ranked = [
        RankedEntry(item_id, m[0], "topic_match", None) for m in probe.moments(item_id)
    ]
    s.feed.replace_user(user, {"3-8": ranked}, datetime.now(UTC))
    return user


# CACHE-1, Q-P1-17 (P1-W4-S04): a user's feed is replaced whole, every chip (Q-P1-16,
# W4-S05), with its time.
def test_a_users_feed_is_replaced_whole_with_its_time(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("uf"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "uf0"), moment(1, "uf1")])
    first, second = (m[0] for m in probe.moments(item))
    user = f"feed-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    assert probe.feed_state(user) is None
    early = datetime(2099, 1, 1, tzinfo=UTC)
    s.feed.replace_user(
        user,
        {
            "3-8": [
                RankedEntry(item, first, "quality", None),
                RankedEntry(item, second, "topic_match", None),
            ],
            "1-3": [RankedEntry(item, second, "time_fit", None)],
        },
        early,
    )
    assert probe.feed_titles("3-8") == ["uf0", "uf1"]
    assert probe.feed_titles("1-3") == ["uf1"]
    later = datetime(2099, 1, 2, tzinfo=UTC)
    s.feed.replace_user(
        user, {"3-8": [RankedEntry(item, second, "freshness", None)]}, later
    )
    assert probe.feed_titles("3-8") == ["uf1"]
    assert probe.feed_titles("1-3") == []  # a chip left out is emptied, not kept
    assert probe.feed_state(user) == later
    # An empty feed still counts as computed (ADR-0008: "not yet" vs "nothing").
    s.feed.replace_user(user, {"3-8": []}, later)
    assert probe.feed_titles() == []
    assert probe.feed_state(user) == later


def test_starter_feeds_are_replaced_per_topic_level_and_chip(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("sf"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "sf0"), moment(1, "sf1")])
    a, b = (m[0] for m in probe.moments(item))
    s.feed.replace_starter(
        "databases", "beginner", "3-8", [RankedEntry(item, a, "q", None)]
    )
    s.feed.replace_starter(
        "databases", "advanced", "3-8", [RankedEntry(item, b, "q", None)]
    )
    s.feed.replace_starter(
        "databases", "beginner", "1-3", [RankedEntry(item, a, "q", None)]
    )
    s.feed.replace_starter(
        "databases",
        "beginner",
        "3-8",
        [RankedEntry(item, b, "quality", None), RankedEntry(item, a, "quality", None)],
    )
    assert probe.starter_ids("databases", "beginner", "3-8") == [b, a]
    assert probe.starter_ids("databases", "beginner", "1-3") == [a]
    assert probe.starter_ids("databases", "advanced", "3-8") == [b]


def test_active_users_used_a_session_in_the_window(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    soon = datetime(2099, 1, 1, tzinfo=UTC)
    recent, stale, never = (f"act-{uuid4().hex[:8]}" for _ in range(3))
    probe.add_user(recent, True, [soon])
    probe.add_user(stale, False, [soon])
    probe.add_user(never, False, [])
    probe.age_sessions(stale, 8)
    since = datetime.now(UTC) - timedelta(days=7)
    active = set(s.feed.active_users(since))
    assert recent in active
    assert stale not in active
    assert never not in active


def test_a_failed_feed_write_keeps_the_previous_feed(
    store: tuple[Store, Probe],
) -> None:
    # LOAD-5: the write is all or nothing; the unit of work it runs in stays usable.
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("kept"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "kept0")])
    (kept,) = (m[0] for m in probe.moments(item))
    user = f"feed-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    first = datetime(2099, 1, 1, tzinfo=UTC)
    s.feed.replace_user(
        user, {"3-8": [RankedEntry(item, kept, "quality", None)]}, first
    )
    twice = [
        RankedEntry(item, kept, "quality", None),
        RankedEntry(item, kept, "freshness", None),
    ]
    with pytest.raises(Exception):  # noqa: B017  the engine's own error
        s.feed.replace_user(
            user, {"1-3": [], "3-8": twice}, datetime(2099, 1, 2, tzinfo=UTC)
        )
    assert probe.feed_titles() == ["kept0"]
    assert probe.feed_state(user) == first


def test_a_feed_for_a_deleted_user_or_moment_is_skipped(
    store: tuple[Store, Probe],
) -> None:
    # A user purged or a moment re-segmented between ranking and writing is not a
    # failure (it would otherwise retry and count as one).
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("gone"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "gone0")])
    (live,) = (m[0] for m in probe.moments(item))
    now = datetime(2099, 1, 1, tzinfo=UTC)
    s.feed.replace_user(
        "never-existed", {"3-8": [RankedEntry(item, live, "q", None)]}, now
    )
    assert probe.feed_state("never-existed") is None
    user = f"feed-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    gone = live + 10_000_000
    s.feed.replace_user(
        user,
        {
            "3-8": [
                RankedEntry(item, gone, "quality", None),
                RankedEntry(item, live, "topic_match", None),
            ]
        },
        now,
    )
    assert probe.feed_titles() == ["gone0"]
    assert probe.feed_state(user) == now


# Whole articles (§3.2, Q-P1-16, Q-P1-39, P1-W4-S05b).
def test_topic_articles_offer_one_copy_per_story_whatever_the_profile(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(
        s,
        parse_concepts(
            "version: 1\nconcepts:\n  - {slug: ta-idx, name: I, topic: databases}\n",
            "c.yaml",
        ),
    )
    url = "https://dup.example.test/ta-shared"
    listing = dup_item(s, dup_source(s, "ta-list", "metadata_only"), "ta1", 1, url=url)
    full = dup_source(s, "ta-full")
    probe.enable_moments(full)
    original = dup_item(s, full, "ta2", 2, url=url)
    s.items.link_duplicates(original)
    solo = dup_item(s, dup_source(s, "ta-meta", "metadata_only"), "ta3", 3)
    s.moments.replace(original, [moment(0, "ta-o")])
    for item in (listing, original, solo):
        s.tags.save(
            item, TagResult(Tags("beginner", frozenset({"ta-idx"})), {}), "m", 1
        )

    def offered(exclude: set[int]) -> list[int]:
        rows = s.ranking.topic_articles(
            ["databases"], 1000, exclude_sources=set(), exclude_items=exclude
        )
        return [r.item_id for r in rows if r.item_id in {listing, original, solo}]

    # One card per story: the copy whose moments the feed shows, not the earlier
    # listing; a metadata-only article on its own is offered too. Newest first.
    assert offered(set()) == [solo, original]
    assert offered({solo}) == [original]
    # A broken link (P1-W6-S03) hands the story to a working copy, moments or not.
    s.items.set_link_broken(original, datetime(2026, 10, 26, tzinfo=UTC))
    assert offered(set()) == [solo, listing]
    s.items.set_link_broken(original, None)
    assert offered(set()) == [solo, original]
    # With no copy that has moments, the earliest copy stands for the story.
    first = dup_item(s, dup_source(s, "ta-a", "metadata_only"), "ta4", 4, url=url + "2")
    later = dup_item(s, dup_source(s, "ta-b", "metadata_only"), "ta5", 6, url=url + "2")
    s.items.link_duplicates(later)
    for item in (first, later):
        s.tags.save(
            item, TagResult(Tags("beginner", frozenset({"ta-idx"})), {}), "m", 1
        )
    rows = s.ranking.topic_articles(
        ["databases"], 1000, exclude_sources=set(), exclude_items=set()
    )
    assert {r.item_id for r in rows} & {first, later} == {first}


def test_article_facts_measure_length_from_stored_sections(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    item = dup_item(s, dup_source(s, "af"), "af1", 8)
    s.items.store_full_text(item, "text")
    s.items.replace_sections(
        item, [Section(None, None, None, 30), Section("A", 2, None, 500)]
    )
    s.tags.save(item, TagResult(Tags("advanced", frozenset()), {}), "m", 1)
    bare = dup_item(s, dup_source(s, "af-meta", "metadata_only"), "af2", 9)
    facts = s.ranking.article_facts([item, bare, 10**12])
    assert set(facts) == {item, bare}
    assert facts[item].minutes == 3  # 530 words at 230 a minute, rounded up
    assert facts[item].difficulty == "advanced"
    assert facts[item].moment_id is None
    assert facts[bare].minutes is None  # no body text: length unknown (Q-P1-39)


def test_a_feed_holds_moments_and_whole_articles_in_rank_order(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("mix"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "mix0")])
    (only,) = (m[0] for m in probe.moments(item))
    user = f"feed-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    now = datetime(2099, 1, 1, tzinfo=UTC)
    mixed = [
        RankedEntry(item, None, "time_fit", None),
        RankedEntry(item, only, "quality", None),
    ]
    s.feed.replace_user(user, {"8-15": mixed}, now)
    assert probe.feed_entries(user, "8-15") == [(item, None), (item, only)]
    whole_twice = [
        RankedEntry(item, None, "a", None),
        RankedEntry(item, None, "b", None),
    ]
    with pytest.raises(Exception):  # noqa: B017  the engine's own error
        s.feed.replace_user(user, {"8-15": whole_twice}, now)
    assert probe.feed_entries(user, "8-15") == [(item, None), (item, only)]
    # Re-segmenting drops the moment's entry; the whole article stays.
    s.moments.replace(item, [])
    assert probe.feed_entries(user, "8-15") == [(item, None)]


# Why-this-matters notes (REC-5, Q-P1-18, P1-W4-S06).
def test_a_note_is_written_once_per_key_and_polished_once(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    src = dup_source(s, "nt")
    item = dup_item(s, src, "nt1", 3)
    key = NoteKey(item, "quality", "beginner", "")
    other_key = NoteKey(item, "quality", "advanced", "")
    first = s.notes.ensure_all(
        {key: "From dup-nt, one of the most trusted sources here.", other_key: "t"}
    )
    # A cache hit: the stored note comes back, whatever text was offered.
    assert s.notes.ensure_all({key: "other words"}) == {key: first[key]}
    assert first[key].needs_polish and first[other_key].needs_polish
    assert first[key].note_id != first[other_key].note_id
    note_id = first[key].note_id
    assert s.notes.input(note_id) == NoteInput(
        note_id,
        "Unique title nt1",
        "dup-nt",
        "From dup-nt, one of the most trusted sources here.",
    )
    s.notes.polish(note_id, "A trusted source on this.", "small-model")
    s.notes.polish(note_id, "A second delivery's words.", "small-model")  # ignored
    assert s.notes.ensure_all({key: "x"}) == {key: NoteRef(note_id, needs_polish=False)}
    assert s.notes.input(note_id) is None  # polished once, never again


def test_a_refused_polish_keeps_the_template_and_is_not_tried_again(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    item = dup_item(s, dup_source(s, "nr"), "nr1", 3)
    key = NoteKey(item, "freshness", "beginner", "")
    (ref,) = s.notes.ensure_all({key: "New this week."}).values()
    s.notes.polish(ref.note_id, None, "small-model")  # the reply was refused
    assert s.notes.input(ref.note_id) is None
    assert not s.notes.ensure_all({key: "x"})[key].needs_polish


# Exploration outcomes (REC-4, P1-W4-S09): written by Week 5, read by ranking.
def test_arm_outcomes_are_read_as_stored(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.record_arm(Arm("topic", "contract-backend"), shown=10, finished=4)
    outcomes = s.ranking.arm_outcomes()
    assert outcomes[Arm("topic", "contract-backend")] == ArmOutcome(10, 4)


# P1-W5-S03: finished moments and articles, which candidates leave out.
def test_finished_reads_moments_and_articles(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("fin"), keep_excerpt=False)
    s.moments.replace(item, [moment(0, "fin0")])
    (only,) = (m[0] for m in probe.moments(item))
    user = f"fin-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    assert s.ranking.finished(user) == Finished(frozenset(), frozenset())
    probe.finish(user, only, item)
    assert s.ranking.finished(user) == Finished(frozenset({only}), frozenset({item}))


def test_topic_moments_leave_out_given_moments_before_the_limit(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = dup_source(s, "tx")
    probe.enable_moments(sid)
    item = dup_item(s, sid, "tx1", 9)
    s.moments.replace(item, [moment(0, "tx-a"), moment(1, "tx-b")])
    first, second = (m[0] for m in probe.moments(item))
    probe.reset_concepts()
    sync_concepts(
        s,
        parse_concepts(
            "version: 1\nconcepts:\n  - {slug: tx-c, name: C, topic: databases}\n",
            "c.yaml",
        ),
    )
    s.tags.save(item, TagResult(Tags("beginner", frozenset({"tx-c"})), {}), "m", 1)

    def offered(limit: int, skip: frozenset[int]) -> list[int]:
        rows = s.ranking.topic_moments(
            ["databases"],
            limit,
            exclude_sources=set(),
            exclude_items=set(),
            exclude_moments=skip,
        )
        return [r.moment_id for r in rows if r.item_id == item]

    assert offered(1000, frozenset({first})) == [second]


# The question bank (Q-1, Q-P2-09, P2-W8-S01): tagged full-text moments are targets;
# drafts replace a moment's questions and go with it.
def _question_item(s: Store, probe: Probe) -> tuple[int, list[int], int]:
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    sid = source(s)
    probe.enable_moments(sid)
    item = s.items.upsert_from_feed(sid, entry("questions"), keep_excerpt=False)
    s.items.store_full_text(item, "Intro\nLag\nbody\nQuorum\nmore")
    # The intro is the page's top; the others are headings an admin can correct.
    anchor = "https://contract.example.test/a#"
    s.moments.replace(
        item,
        [
            moment(0, "intro"),
            MomentRow(1, "Lag", 1, f"{anchor}lag", "anchor"),
            MomentRow(2, "Quorum", 1, f"{anchor}quorum", "anchor"),
        ],
    )
    tag_input = s.tags.input(item)
    assert tag_input is not None
    ids = [m.id for m in tag_input.moments]
    s.tags.save(
        item,
        TagResult(
            Tags("intermediate", frozenset({"cg-lag"})),
            {
                ids[1]: Tags("advanced", frozenset({"cg-lag", "cg-replication"})),
                ids[2]: Tags("advanced", frozenset({"cg-quorum"})),
            },
        ),
        "small-model",
        1,
    )
    return item, ids, sid


def test_tagged_full_text_moments_are_question_targets(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    item, (intro, lag, quorum), sid = _question_item(s, probe)
    target = s.questions.target(lag)
    assert target is not None and target.item_id == item
    assert target.concepts == (("cg-lag", "Lag"), ("cg-replication", "Replication"))
    assert s.questions.target(intro) is None  # untagged
    assert s.questions.targets(item) == [lag, quorum]
    assert lag in s.questions.targets(None)
    # An admin's correction replaces the model's tags, by the moment's heading.
    probe.correct_moment_concepts(item, "Quorum", ["cg-ryw"])
    corrected = s.questions.target(quorum)
    assert corrected is not None and corrected.concepts == (("cg-ryw", "RYW"),)
    # A source that stops allowing moments makes none of them targets (ING-2).
    probe.switch_moments_off(sid, True)
    assert s.questions.target(lag) is None


def test_drafts_replace_a_moments_questions_and_remember_their_hash(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    item, (_, lag, _), _ = _question_item(s, probe)
    assert s.questions.drafted_hash(lag) is None
    draft = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")
    first = s.questions.save(lag, [draft, draft], ["cg-lag"], "m", 1, "h1", None)
    assert len(first) == 2 and s.questions.drafted_hash(lag) == "h1"
    again = s.questions.save(lag, [draft, draft], ["cg-lag"], "m", 1, "h2", None)
    assert set(again).isdisjoint(first) and s.questions.drafted_hash(lag) == "h2"
    # Questions go with their moment (and so with its rights, ING-2).
    s.moments.replace(item, [moment(0, "intro")])
    assert s.questions.drafted_hash(lag) is None


def test_a_verdict_makes_a_pending_question_live_or_rejected_once(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, _), _ = _question_item(s, probe)
    draft = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")
    right, wrong = s.questions.save(lag, [draft, draft], ["cg-lag"], "m", 1, "h1", None)
    assert s.questions.pending(right) == (lag, draft)
    assert s.questions.record_verdict(right, "validator", 2) is True
    assert s.questions.record_verdict(wrong, "validator", 1) is True
    # Decided once: no longer pending, and a repeat changes nothing.
    assert s.questions.pending(right) is None
    assert s.questions.record_verdict(right, "validator", 0) is False
    # A redraft's questions are pending again; the decided ones are retired.
    (again, _) = s.questions.save(lag, [draft, draft], ["cg-lag"], "m", 1, "h2", None)
    assert s.questions.pending(again) == (lag, draft)
    assert s.questions.pending(wrong) is None


def test_the_summary_counts_by_status_and_samples_validated_questions(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    # A local database may already hold real questions: counted from what was there.
    before = s.questions.summary(0).counts
    _, (_, lag, quorum), _ = _question_item(s, probe)
    draft = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")
    right, wrong = s.questions.save(lag, [draft, draft], ["cg-lag"], "m", 1, "h1", None)
    s.questions.save(quorum, [draft, draft], ["cg-quorum"], "m", 1, "h1", None)
    s.questions.record_verdict(right, "v", 2)
    s.questions.record_verdict(wrong, "v", 0)
    got = s.questions.summary(100_000)
    added = {k: got.counts.get(k, 0) - before.get(k, 0) for k in got.counts}
    assert {k: n for k, n in added.items() if n} == {
        "live": 1,
        "rejected": 1,
        "pending": 2,
    }
    assert sorted(
        (q.question_id, q.validator_answer, q.status)
        for q in got.sample
        if q.question_id in (right, wrong)
    ) == [
        (right, 2, "live"),
        (wrong, 0, "rejected"),
    ]
    assert all(q.status in ("live", "rejected") for q in got.sample)
    assert len(s.questions.summary(1).sample) == 1


# Q-2 (P2-W8-S03): a weekly random share of the week's new live questions, plus every
# flagged one, queued once each for review.
def test_spot_checks_sample_new_live_questions_and_take_every_flagged_one(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, quorum), _ = _question_item(s, probe)
    draft = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")
    a, b = s.questions.save(lag, [draft, draft], ["cg-lag"], "m", 1, "h1", None)
    c, d = s.questions.save(quorum, [draft, draft], ["cg-quorum"], "m", 1, "h1", None)
    since = datetime.now(UTC) - timedelta(seconds=1)
    # The window is by when a question went live, not when it was drafted.
    for qid in (a, b, c, d):
        s.questions.record_verdict(qid, "v", 2)  # live
    probe.flag_question(d)
    # 10% of 4 newly validated questions rounds up to 1; the flagged one always goes.
    assert s.questions.queue_spot_checks(since, 0.1) == (1, 1)
    queued = probe.reviews()
    assert (d, "flagged", False) in queued
    sampled = [q for q, r, _ in queued if r == "sample"]
    assert len(sampled) == 1 and sampled[0] in (a, b, c)
    # A rerun the same week queues nothing twice, even after the sample was retired.
    probe.retire_question(sampled[0])
    assert s.questions.queue_spot_checks(since, 0.1) == (0, 0)
    # A bigger share samples more, from the live ones never sampled.
    assert s.questions.queue_spot_checks(since, 0.75) == (2, 0)
    # A flagged question kept once and flagged again goes back in.
    probe.decide_review(d)
    probe.flag_question(d)
    assert s.questions.queue_spot_checks(since, 0.75) == (0, 1)
    assert sum(q == d for q, _, _ in probe.reviews()) == 2
    # Nothing validated after the window starts: nothing sampled.
    later = datetime.now(UTC) + timedelta(days=1)
    assert s.questions.queue_spot_checks(later, 1.0) == (0, 0)


# Q-3, Q-P2-11 (P2-W8-S04): a question starts at its moment's level, an admin's
# correction winning.
def test_a_question_starts_at_its_moments_difficulty(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    item, (_, lag, quorum), _ = _question_item(s, probe)
    target = s.questions.target(lag)
    assert target is not None and target.difficulty == "advanced"
    # The admin page saves a heading's level and concepts together.
    probe.correct_moment_concepts(item, "Quorum", ["cg-quorum"])
    corrected = s.questions.target(quorum)
    assert corrected is not None and corrected.difficulty == "beginner"
    draft = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")
    (first, _) = s.questions.save(
        lag, [draft, draft], ["cg-lag"], "m", 1, "h1", target.difficulty
    )
    assert probe.question_difficulty(first) == "advanced"


# Q-P2-13 (P2-W8-S05): batches remember what each request was for; an open batch
# holds its moments and questions; broken replies count per moment.
def test_question_batches_hold_their_items_until_closed_and_count_broken_replies(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    # A local database may already hold real pending questions.
    before = set(s.questions.pending_questions())
    held_moments, held_questions = s.questions.in_open_batches()

    def open_ours() -> list[tuple[str, str]]:
        return [(b, k) for b, k, _ in s.questions.open_batches() if b in ("b1", "b2")]

    def in_ours() -> tuple[set[int], set[int]]:
        moments, questions = s.questions.in_open_batches()
        return moments - held_moments, questions - held_questions

    _, (_, lag, quorum), _ = _question_item(s, probe)
    draft = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")
    (pending, _) = s.questions.save(
        quorum, [draft, draft], ["cg-quorum"], "m", 1, "h1", None
    )
    assert [q for q in s.questions.pending_questions() if q not in before] == sorted(
        s.questions.pending_ids(quorum)
    )
    s.questions.record_batch(
        "b1",
        "draft",
        "haiku",
        [
            QuestionBatchEntry(f"draft-{lag}", lag, None, "h-lag"),
            QuestionBatchEntry(f"draft-{quorum}", quorum, None, "h-q"),
        ],
    )
    s.questions.record_batch(
        "b2",
        "validate",
        "haiku",
        [QuestionBatchEntry(f"v-{pending}", None, pending, None)],
    )
    assert open_ours() == [("b1", "draft"), ("b2", "validate")]
    assert all(at.tzinfo is not None for _, _, at in s.questions.open_batches())
    assert in_ours() == ({lag, quorum}, {pending})
    assert s.questions.batch_entries("b1") == [
        QuestionBatchEntry(f"draft-{lag}", lag, None, "h-lag"),
        QuestionBatchEntry(f"draft-{quorum}", quorum, None, "h-q"),
    ]
    # The cost is claimed once, whatever happens to the closing after it.
    assert s.questions.claim_batch_cost("b1", Decimal("0.0002")) is True
    assert s.questions.claim_batch_cost("b1", Decimal("0.0002")) is False
    s.questions.close_batch(
        "b1", "completed", {f"draft-{lag}": "broken", f"draft-{quorum}": "saved"}
    )
    assert open_ours() == [("b2", "validate")]
    assert in_ours() == (set(), {pending})
    broken_moments, broken_questions = s.questions.broken_counts()
    assert {k: n for k, n in broken_moments.items() if k[0] in (lag, quorum)} == {
        (lag, "h-lag"): 1
    }
    assert pending not in broken_questions
    # A failed batch frees its items without results.
    s.questions.close_batch("b2", "failed", {})
    assert open_ours() == []
    assert in_ours() == (set(), set())
