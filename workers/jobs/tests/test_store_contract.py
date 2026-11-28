"""Store contract (ADR-0012): the same repository cases against the in-memory fake and
the Postgres adapter, so logic tested on the fake behaves the same on the database.

Ports have no read methods that only tests need; each store gets a test-side probe that
inspects its state (internal fields for the fake, SQL for Postgres).
"""

import time
from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Protocol, get_args
from uuid import uuid4

import psycopg
import pytest

from interval_db.generated import Difficulty, RightsProfile, Topic
from interval_jobs.adapters.memory import (
    GOAL_CONCEPTS,
    RANKING_DEFAULTS,
    InMemoryAi,
    InMemoryStore,
    StoredQuestion,
    StoredUser,
)
from interval_jobs.adapters.postgres import PostgresAi, PostgresStore
from interval_jobs.concepts.graph import ConceptSeedError, parse_concepts
from interval_jobs.concepts.sync import sync_concepts
from interval_jobs.irt import Answer
from interval_jobs.ports import (
    LEARNING_GOALS,
    AiLedger,
    Arm,
    ArmOutcome,
    ConceptCycleError,
    ConceptEdge,
    ConceptGraph,
    DraftSection,
    DuplicateInviteCode,
    EstimateDraft,
    FeedEntry,
    ItemDecisions,
    NoteBatchEntry,
    PathDraft,
    QuestionBatchEntry,
    QuestionDraft,
    QuestionKind,
    RankedEntry,
    RightsViolation,
    Section,
    SessionCandidate,
    SourceSettings,
    StemCandidate,
    Store,
    TagResult,
    Tags,
    Usage,
    UserPreferences,
    Validators,
)
from interval_jobs.tagging_rollup import rollup


def email_of(user_id: str) -> str:
    return f"{user_id}@contract.example.test"


# reset_concepts: tries of its truncate, each giving up after a short lock timeout.
TRUNCATE_TRIES = 10


class Probe(Protocol):
    def excerpt(self, item_id: int) -> str | None: ...
    def full_text(self, item_id: int) -> str | None: ...
    # (heading, anchor id, words, level), in order
    def sections(
        self, item_id: int
    ) -> list[tuple[str | None, str | None, int, int | None]]: ...
    def item_tags(self, item_id: int) -> Tags | None: ...
    def feed_state(self, user_id: str) -> datetime | None: ...
    # ADR-0058: one list of articles per feed.
    def feed_entries(self, user_id: str) -> list[int]: ...
    def starter_ids(self, topic: str, level: Difficulty) -> list[int]: ...
    def age_sessions(self, user_id: str, days: int) -> None: ...
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
    def reset_concepts(self) -> None: ...
    # What the web app writes about a user (P1-W4-S01, W4-S07).
    def set_preferences(
        self, user_id: str, topics: list[str], goals: list[str] | None = None
    ) -> None: ...
    def give_feedback(self, user_id: str, item_id: int, kind: str) -> None: ...
    def save(self, user_id: str, item_id: int) -> None: ...
    def hide_source(self, user_id: str, source_id: int) -> None: ...
    def reset_inferred(self, user_id: str) -> None: ...
    def record_arm(self, arm: Arm, shown: int, finished: int) -> None: ...
    def finish(self, user_id: str, item_id: int) -> None: ...
    def correct_concepts(self, item_id: int, slugs: list[str]) -> None: ...
    def flag_question(self, question_id: int) -> None: ...
    # ADR-0058: a pending question drafted for one of the article's moments, folded
    # into the article (from_moments, DRAFT); its id.
    def carry_over_question(self, item_id: int) -> int: ...
    # ADR-0058: an estimate drafted for one of the article's moments, folded in.
    def carry_over_estimate(self, item_id: int) -> None: ...
    def question_ids(self, item_id: int) -> list[int]: ...
    # The article's multiple-choice slots (article_ordinal), retired ones too.
    def question_slots(self, item_id: int) -> list[int]: ...
    # A user's answer to a question in a finished Test 60s, or in a review (which
    # P2-W9-S08 leaves out).
    def add_answer(
        self, user_id: str, question_id: int, correct: bool, review: bool = False
    ) -> None: ...
    def question_calibrated(self, question_id: int) -> bool: ...
    # A saved path: status, name, and each section's concepts (sorted) and articles.
    def path(
        self, path_id: int
    ) -> tuple[str, str, list[tuple[tuple[str, ...], tuple[int, ...]]]]: ...
    def reviews(self) -> list[tuple[int, str, bool]]: ...
    def decide_review(self, question_id: int) -> None: ...
    def question_difficulty(self, question_id: int) -> str | None: ...
    # Who drafted it, under which prompt, and who validated it last.
    def question_writers(self, question_id: int) -> tuple[str, int, str | None]: ...
    def retire_question(self, question_id: int) -> None: ...
    def override_level(self, item_id: int, level: str) -> None: ...
    def simhash(self, item_id: int) -> int | None: ...


@dataclass
class MemoryProbe:
    s: InMemoryStore

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
            row.paywalled,
            row.quality_score,
            tuple(row.topics),
        )

    def has_item(self, item_id: int) -> bool:
        return item_id in self.s.items.rows

    def primary_of(self, item_id: int) -> int | None:
        return self.s.items.rows[item_id].duplicate_of

    def reset_concepts(self) -> None:
        pass  # a fresh store has no graph

    def set_preferences(
        self, user_id: str, topics: list[str], goals: list[str] | None = None
    ) -> None:
        self.s.ranking.preferences_by_user[user_id] = UserPreferences(
            [t for t in get_args(Topic.__value__) if t in topics],
            "beginner",
            [g for g in LEARNING_GOALS if g in (goals or [])],
        )

    def give_feedback(self, user_id: str, item_id: int, kind: str) -> None:
        self.s.ranking.feedback.append((user_id, item_id, kind))

    def save(self, user_id: str, item_id: int) -> None:
        self.s.ranking.saves.append((user_id, item_id))

    def hide_source(self, user_id: str, source_id: int) -> None:
        self.s.ranking.hidden.add((user_id, source_id))

    def finish(self, user_id: str, item_id: int) -> None:
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

    def flag_question(self, question_id: int) -> None:
        next(q for q in self.s.questions.rows if q.id == question_id).status = "flagged"

    def carry_over_question(self, item_id: int) -> int:
        questions = self.s.questions
        question = StoredQuestion(
            10**6 + len(questions.rows),
            item_id,
            max((q.ordinal for q in questions.rows if q.item_id == item_id), default=-1)
            + 1,
            DRAFT,
            (),
            "m",
            1,
            "moment-hash",
            from_moments=True,
        )
        questions.rows.append(question)
        return question.id

    def carry_over_estimate(self, item_id: int) -> None:
        self.s.questions.estimates_from_moments.add(item_id)

    def question_ids(self, item_id: int) -> list[int]:
        return sorted(q.id for q in self.s.questions.rows if q.item_id == item_id)

    def question_slots(self, item_id: int) -> list[int]:
        return sorted(
            q.ordinal
            for q in self.s.questions.rows
            if q.item_id == item_id and q.kind == "choice"
        )

    def add_answer(
        self, user_id: str, question_id: int, correct: bool, review: bool = False
    ) -> None:
        # The fake keeps Test 60s answers only, as the job reads them.
        if not review:
            self.s.questions.answers.append(Answer(user_id, question_id, correct))

    def question_calibrated(self, question_id: int) -> bool:
        stored = next(q for q in self.s.questions.rows if q.id == question_id)
        return stored.calibrated_at is not None

    def path(
        self, path_id: int
    ) -> tuple[str, str, list[tuple[tuple[str, ...], tuple[int, ...]]]]:
        saved = self.s.paths.rows[path_id]
        return (
            saved.status,
            saved.draft.name,
            [
                (tuple(sorted(sec.concepts)), sec.item_ids)
                for sec in saved.draft.sections
            ],
        )

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

    def question_writers(self, question_id: int) -> tuple[str, int, str | None]:
        q = next(q for q in self.s.questions.rows if q.id == question_id)
        return q.model, q.prompt_version, q.validator_model

    def override_level(self, item_id: int, level: str) -> None:
        assert level in ("beginner", "intermediate", "advanced")
        self.s.tags.overrides[item_id] = level

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

    def sections(
        self, item_id: int
    ) -> list[tuple[str | None, str | None, int, int | None]]:
        return [
            (x.heading, x.anchor_id, x.word_count, x.level)
            for x in self.s.items.rows[item_id].sections
        ]

    def item_tags(self, item_id: int) -> Tags | None:
        row = self.s.tags.rows.get(item_id)
        return None if row is None else row[0]

    def feed_state(self, user_id: str) -> datetime | None:
        return self.s.feed.computed.get(user_id)

    def feed_entries(self, user_id: str) -> list[int]:
        return [r.item_id for r in self.s.feed.users.get(user_id, [])]

    def starter_ids(self, topic: str, level: Difficulty) -> list[int]:
        return [r.item_id for r in self.s.feed.starters.get((topic, level), [])]

    def age_sessions(self, user_id: str, days: int) -> None:
        user = self.s.users.rows[user_id]
        user.session_seen = datetime.now(UTC) - timedelta(days=days)


@dataclass
class PostgresProbe:
    conn: psycopg.Connection

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
            "select active, feed_url, rights_profile::text, "
            "paywalled, quality_score, topics from source where name = %s",
            (name,),
        ).fetchone()
        return None if row is None else (*row[:5], tuple(row[5]))

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

    def sections(
        self, item_id: int
    ) -> list[tuple[str | None, str | None, int, int | None]]:
        return self.conn.execute(
            "select heading, anchor_id, word_count, level from content_item_section "
            "where content_item_id = %s order by ordinal",
            (item_id,),
        ).fetchall()

    def item_tags(self, item_id: int) -> Tags | None:
        row = self.conn.execute(
            """
            select it.difficulty,
                   coalesce(array_agg(c.slug) filter (where c.slug is not null), '{}')
            from item_tagging it
            left join item_concept ic on ic.content_item_id = it.content_item_id
            left join concept c on c.id = ic.concept_id
            where it.content_item_id = %s
            group by it.difficulty
            """,
            (item_id,),
        ).fetchone()
        return None if row is None else Tags(row[0], frozenset(row[1]))

    def override_level(self, item_id: int, level: str) -> None:
        # The admin page's whole-article row: the level, and the concepts it keeps.
        self.conn.execute(
            "insert into tag_override (content_item_id, difficulty, "
            "concepts, updated_by) "
            "select %s, %s, coalesce(array_agg(c.slug), '{}'), 'contract-test' "
            "from item_concept ic join concept c on c.id = ic.concept_id "
            "where ic.content_item_id = %s "
            "on conflict (content_item_id) do update "
            "set difficulty = excluded.difficulty",
            (item_id, level, item_id),
        )

    def set_preferences(
        self, user_id: str, topics: list[str], goals: list[str] | None = None
    ) -> None:
        # At least one goal, as the database requires (ADR-0015).
        self.conn.execute(
            "insert into user_preferences (user_id, topics, level, goals) "
            "values (%s, %s::topic[], 'beginner', %s::learning_goal[])",
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

    def finish(self, user_id: str, item_id: int) -> None:
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
            "insert into tag_override (content_item_id, difficulty, concepts, "
            "updated_by) values (%s, 'beginner', %s, 'contract-test')",
            (item_id, slugs),
        )

    def flag_question(self, question_id: int) -> None:
        self.conn.execute(
            "update question set status = 'flagged' where id = %s", (question_id,)
        )

    def add_answer(
        self, user_id: str, question_id: int, correct: bool, review: bool = False
    ) -> None:
        # The web app writes these (P2-W9-S01, S05); here, one finished attempt each.
        self.conn.execute(
            """
            with attempt as (
              insert into quiz_attempt
                (user_id, content_item_id, started_at, ends_at, finished_at, review)
              select %(user)s,
                     case when %(review)s then null else q.content_item_id end,
                     now() - interval '2 minutes',
                     case when %(review)s then null
                          else now() - interval '1 minute' end,
                     now() - interval '1 minute', %(review)s
              from question q
              where q.id = %(question)s
              returning id
            )
            insert into quiz_answer
              (attempt_id, question_id, served_at, chosen, correct, answered_at)
            select id, %(question)s, now() - interval '2 minutes',
                   case when %(correct)s then 0 else 1 end, %(correct)s,
                   now() - interval '90 seconds'
            from attempt
            """,
            {
                "user": user_id,
                "question": question_id,
                "correct": correct,
                "review": review,
            },
        )

    def question_calibrated(self, question_id: int) -> bool:
        row = self.conn.execute(
            "select calibrated_at is not null from question where id = %s",
            (question_id,),
        ).fetchone()
        assert row is not None
        return bool(row[0])

    def path(
        self, path_id: int
    ) -> tuple[str, str, list[tuple[tuple[str, ...], tuple[int, ...]]]]:
        head = self.conn.execute(
            "select status, name from path where id = %s", (path_id,)
        ).fetchone()
        assert head is not None
        sections = self.conn.execute(
            """
            select
              array(select c.slug from path_section_concept pc
                    join concept c on c.id = pc.concept_id
                    where pc.section_id = s.id order by c.slug),
              array(select ps.content_item_id from path_session ps
                    where ps.section_id = s.id order by ps.ordinal)
            from path_section s where s.path_id = %s order by s.ordinal
            """,
            (path_id,),
        ).fetchall()
        return (
            str(head[0]),
            str(head[1]),
            [(tuple(c), tuple(int(m) for m in ms)) for c, ms in sections],
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

    def question_writers(self, question_id: int) -> tuple[str, int, str | None]:
        row = self.conn.execute(
            "select generator_model, prompt_version, validator_model from question "
            "where id = %s",
            (question_id,),
        ).fetchone()
        assert row is not None
        return str(row[0]), int(row[1]), None if row[2] is None else str(row[2])

    def carry_over_question(self, item_id: int) -> int:
        # A question the moment-era worker drafted for one of its moments, as stage C
        # folded it into the article: the article's next slot, marked from_moments.
        row = self.conn.execute(
            "insert into question (content_item_id, article_ordinal, ordinal, stem, "
            "options, correct, citation, generator_model, prompt_version, "
            "content_hash, from_moments) "
            "select %s, n, n, %s, %s, %s, %s, 'm', 1, 'moment-hash', true from ("
            "select coalesce(max(article_ordinal) + 1, 0) as n from question "
            "where content_item_id = %s and kind = 'choice') s returning id",
            (
                item_id,
                DRAFT.stem,
                list(DRAFT.options),
                DRAFT.correct,
                DRAFT.citation,
                item_id,
            ),
        ).fetchone()
        assert row is not None
        return int(row[0])

    def carry_over_estimate(self, item_id: int) -> None:
        self.conn.execute(
            "insert into question_estimate_drafted "
            "(content_item_id, content_hash, from_moments) "
            "values (%s, 'moment-hash', true)",
            (item_id,),
        )

    def question_ids(self, item_id: int) -> list[int]:
        rows = self.conn.execute(
            "select id from question where content_item_id = %s order by id",
            (item_id,),
        ).fetchall()
        return [int(r[0]) for r in rows]

    def question_slots(self, item_id: int) -> list[int]:
        rows = self.conn.execute(
            "select article_ordinal from question where content_item_id = %s "
            "and kind = 'choice' order by article_ordinal",
            (item_id,),
        ).fetchall()
        return [int(r[0]) for r in rows]

    def reset_concepts(self) -> None:
        # A local database may hold the real graph; the test's transaction rolls this
        # back. Truncate skips the never-deleted row trigger.
        # The truncate takes exclusive locks on concept and every table that references
        # it, one at a time, while the web suites read those tables in the same database
        # (CI runs them together): each side could end up waiting on the other. A lock
        # timeout under Postgres's 1 s deadlock check makes this side give up first,
        # release what it took (the savepoint) and try again; a reader is never the
        # deadlock's victim.
        for attempt in range(TRUNCATE_TRIES):
            try:
                with self.conn.transaction():
                    self.conn.execute("set local lock_timeout = '500ms'")
                    self.conn.execute(
                        "truncate concept_edge, graph_version, concept cascade"
                    )
                    self.conn.execute("set local lock_timeout = 0")
                return
            except psycopg.errors.LockNotAvailable:
                if attempt == TRUNCATE_TRIES - 1:
                    raise
                time.sleep(0.2 * (attempt + 1))

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

    def feed_state(self, user_id: str) -> datetime | None:
        row = self.conn.execute(
            "select computed_at from user_feed_state where user_id = %s", (user_id,)
        ).fetchone()
        return None if row is None else row[0]

    def feed_entries(self, user_id: str) -> list[int]:
        rows = self.conn.execute(
            "select content_item_id from user_feed_entry "
            "where user_id = %s order by rank",
            (user_id,),
        ).fetchall()
        return [int(r[0]) for r in rows]

    def starter_ids(self, topic: str, level: Difficulty) -> list[int]:
        rows = self.conn.execute(
            "select content_item_id from starter_feed_entry where topic = %s "
            "and level = %s::difficulty order by rank",
            (topic, level),
        ).fetchall()
        return [int(r[0]) for r in rows]

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
    s, probe = store
    item = s.items.upsert_from_feed(source(s), entry("g3"), keep_excerpt=False)
    s.items.replace_sections(
        item, [Section("A", 2, "a", 10), Section(None, None, None, 5)]
    )
    s.items.replace_sections(item, [Section("B", 2, None, 7), Section("C", 3, "c", 9)])
    assert probe.sections(item) == [("B", None, 7, 2), ("C", "c", 9, 3)]


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


def change_profile(s: Store, profile_from: RightsProfile, to: RightsProfile) -> None:
    s.sources.upsert(
        name=f"contract-{profile_from}",
        feed_url=f"https://contract.example.test/{profile_from}.xml",
        rights_profile=to,
        homepage=None,
    )


def test_lowering_full_text_purges_text_and_what_was_made_from_it(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    item = s.items.upsert_from_feed(
        sid, entry("purge", datetime(2099, 12, 1, tzinfo=UTC)), keep_excerpt=False
    )
    s.items.store_full_text(item, "body")
    s.items.replace_sections(item, [Section("A", 2, "a", 10)])
    s.embeddings.save(item, unit(1), "voyage-3.5")
    (question,) = s.questions.save(item, [DRAFT], [], "m", 1, "h", None)
    s.questions.save_estimate(item, None, [], "m", "e", None)
    s.questions.record_retry(item, 1, datetime(2099, 1, 1, tzinfo=UTC))

    change_profile(s, "full_text_internal", "excerpt")
    assert probe.full_text(item) is None
    assert probe.sections(item) == []
    # ING-2, ADR-0058: the article's vector and questions were made from its text.
    assert s.embeddings.vector(item, "voyage-3.5") is None
    assert s.questions.pending(question) is None
    assert probe.question_ids(item) == []
    # Its drafting state goes too, so the article is drafted again if rights return.
    assert s.questions.estimate_drafted_hash(item) is None
    assert s.questions.retry_state(item) is None
    # Rights back and the text stored again: it is embedded again.
    change_profile(s, "full_text_internal", "full_text_internal")
    assert s.embeddings.missing(item, "voyage-3.5") is False  # no text yet
    s.items.store_full_text(item, "body")
    assert s.embeddings.missing(item, "voyage-3.5") is True


# ING-2, ADR-0058: tagging answers asked about the full text, and the tags rolled up
# from them, go with it; the title pass's answers and tags read off no full text stay.
def test_lowering_full_text_purges_the_tagging_read_off_it(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    sid = source(s)
    item = s.items.upsert_from_feed(sid, entry("tagpurge"), keep_excerpt=False)
    other = s.items.upsert_from_feed(sid, entry("tagkept"), keep_excerpt=False)
    s.items.store_full_text(item, "body")
    whole, title = {"cg-lag": 0.9}, {"cg-lag": 0.6}
    s.decisions.save_item(item, "m", "whole", 1.0, whole, from_full_text=True)
    s.decisions.save_item(item, "t", "title", 1.0, title, from_full_text=False)
    tags = Tags("beginner", frozenset({"cg-lag"}))
    s.tags.save(item, TagResult(tags, {}, True), "m", 1)
    s.tags.save(other, TagResult(tags, {}, False), "m", 1)

    change_profile(s, "full_text_internal", "excerpt")
    assert s.decisions.item_hash(item, "m") is None
    assert s.decisions.item_hash(item, "t") == "title"
    # No tags left: the next tag pass asks about what its rights allow now.
    assert s.tags.version(item) is None
    assert s.tags.needs_tagging(item, 1) is True
    assert s.tags.version(other) == 1


def test_a_changed_text_is_embedded_again(store: tuple[Store, Probe]) -> None:
    s, _ = store
    item = s.items.upsert_from_feed(source(s), entry("retext"), keep_excerpt=False)
    s.items.store_full_text(item, "first")
    s.embeddings.save(item, unit(1), "voyage-3.5")
    s.items.store_full_text(item, "first")  # the same text: the vector stands
    assert s.embeddings.missing(item, "voyage-3.5") is False
    s.items.store_full_text(item, "second")
    assert s.embeddings.vector(item, "voyage-3.5") is None
    assert s.embeddings.missing(item, "voyage-3.5") is True


def test_lowering_rights_succeeds_after_a_question_was_played_in_a_match(
    conn: psycopg.Connection,
) -> None:
    # A match's rounds go with a purged question (ING-2) rather than refusing it.
    s = PostgresStore(conn)
    item = s.items.upsert_from_feed(source(s), entry("played"), keep_excerpt=False)
    s.items.store_full_text(item, "body")
    (question,) = s.questions.save(item, [DRAFT], [], "m", 1, "h", None)
    match = conn.execute(
        "insert into game_match (server_id) values (0) returning id"
    ).fetchone()
    assert match is not None
    conn.execute(
        "insert into game_match_question (match_id, round, question_id) "
        "values (%s, 1, %s)",
        (match[0], question),
    )
    change_profile(s, "full_text_internal", "metadata_only")
    rounds = conn.execute(
        "select count(*) from game_match_question where match_id = %s", (match[0],)
    ).fetchone()
    assert rounds == (0,)
    assert s.questions.pending(question) is None


def test_lowering_excerpt_purges_the_excerpt(store: tuple[Store, Probe]) -> None:
    s, probe = store
    sid = source(s, "excerpt")
    item = s.items.upsert_from_feed(sid, entry("ex"), keep_excerpt=True)
    s.items.set_excerpt(item, "e")
    change_profile(s, "excerpt", "metadata_only")
    assert probe.excerpt(item) is None


def test_writes_the_profile_forbids_are_refused(store: tuple[Store, Probe]) -> None:
    s, _ = store
    meta = s.items.upsert_from_feed(source(s, "metadata_only"), entry("m"), False)
    full = s.items.upsert_from_feed(source(s), entry("f"), False)
    for write in (
        lambda: s.items.store_full_text(meta, "x"),
        lambda: s.items.replace_sections(meta, [Section("A", 2, None, 1)]),
        lambda: s.items.set_excerpt(full, "x"),
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
    assert ai.spent_usd("ai-user", day, excluding=()) == Decimal("0.10")
    assert ai.spent_usd(None, day, excluding=()) == Decimal("1.25")
    assert ai.spent_usd("ai-user", date(2099, 1, 3), excluding=()) == Decimal("0")
    # Owner, 2026-10-28: Voyage's spend can be left out of a budget.
    ai.record(
        Usage(
            user_id=None,
            feature="embeddings",
            provider="voyage",
            model="voyage-4",
            input_tokens=100,
            output_tokens=0,
            cost_usd=Decimal("0.75"),
            occurred_at=datetime(2099, 1, 2, 13, 0, tzinfo=UTC),
        )
    )
    assert ai.spent_usd(None, day, excluding=()) == Decimal("2.00")
    assert ai.spent_usd(None, day, excluding={"voyage"}) == Decimal("1.25")


def test_a_deleted_users_spend_never_counts_as_offline_spend(
    ledger: tuple[AiLedger, Probe],
) -> None:
    ai, probe = ledger
    probe.add_user("ai-gone", False, [])
    ai.record(usage("ai-gone", "0.40", datetime(2099, 1, 4, 9, 0, tzinfo=UTC)))
    probe.delete_user("ai-gone")
    assert ai.spent_usd(None, date(2099, 1, 4), excluding=()) == Decimal("0")


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
    paywalled: bool = False,
    quality_score: int | None = None,
    topics: tuple[str, ...] = ("backend",),
) -> SourceSettings:
    return SourceSettings(
        name=name,
        homepage=None,
        feed_url=f"https://{name}.example.test/feed",
        rights_profile=rights_profile,
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
    assert state[3:] == (True, 2, ("databases",))


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
    s.sources.sync([seed("sync-lower", rights_profile="metadata_only")])
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
def test_what_the_fetch_stage_reads(store: tuple[Store, Probe]) -> None:
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
# retuned without asking again, with the hash of what was asked about. One pass per
# article (ADR-0058).
def test_decisions_are_kept_per_article_with_their_hashes(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    item = s.items.upsert_from_feed(source(s), entry("decided"), keep_excerpt=False)
    model = "perplexity/pplx-decider-v1.2"
    assert s.decisions.item_hash(item, model) is None
    s.decisions.save_item(
        item, model, "t0", 1.2, {"cg-lag": 0.9, "cg-ryw": 0.1}, from_full_text=True
    )
    # Asked again after its text changed: the new answers replace the old ones.
    s.decisions.save_item(item, model, "t1", 0.7, {"cg-ryw": 0.8}, from_full_text=False)
    assert s.decisions.item_hash(item, model) == "t1"
    got = s.decisions.read(item, model)
    assert got == ItemDecisions({}, {"cg-ryw": 0.8}, 0.7, False)
    assert s.decisions.read(item, "another/model") == ItemDecisions({}, {})
    with pytest.raises(ValueError, match="no concept"):
        s.decisions.save_item(
            item, model, "t2", 1.0, {"cg-nobody": 0.5}, from_full_text=False
        )


# ADR-0058: the answers an article's moments had are kept under their own keys
# (article_decisions) and read as its sections beside the model's own pass: the
# rollup's section rules apply to them, its title cut to the own pass.
def test_the_moments_answers_are_read_as_the_articles_sections(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    item = s.items.upsert_from_feed(source(s), entry("folded"), keep_excerpt=False)
    model = "perplexity/pplx-decider-v1.2"

    def save(key: str, difficulty: float, probabilities: dict[str, float]) -> None:
        s.decisions.save_item(
            item, key, "h", difficulty, probabilities, from_full_text=True
        )

    # Stage A's copy alone (its moments gone): one section.
    save(f"moments:{model}", 2.0, {"cg-lag": 0.9})
    assert s.decisions.read(item, model) == ItemDecisions(
        {}, {}, None, True, {-1: (2.0, {"cg-lag": 0.9})}
    )
    # Each moment's own answers replace it as the sections.
    save(f"moments:{model}:0", 1.0, {"cg-lag": 0.8, "cg-ryw": 0.75})
    save(f"moments:{model}:1", 1.0, {"cg-ryw": 0.72})
    s.decisions.save_item(
        item, model, "t", 0.5, {"cg-quorum": 0.6}, from_full_text=False
    )
    got = s.decisions.read(item, model)
    assert got.folded == {
        0: (1.0, {"cg-lag": 0.8, "cg-ryw": 0.75}),
        1: (1.0, {"cg-ryw": 0.72}),
    }
    assert (got.item, got.item_difficulty, got.from_full_text) == (
        {"cg-quorum": 0.6},
        0.5,
        True,
    )
    # cg-lag is in one moment under the strong cut: left out. cg-ryw is over the
    # section cut in two: kept. The own pass's cg-quorum is over the title cut: kept.
    tags = rollup(got, {"cg-lag", "cg-ryw", "cg-quorum"})
    assert tags.item.concepts == frozenset({"cg-ryw", "cg-quorum"})
    assert tags.sessions == {}
    assert tags.from_full_text is True
    # Asked again, the model's own answers are replaced; the moments' stay.
    s.decisions.save_item(item, model, "t2", 0.5, {}, from_full_text=False)
    assert s.decisions.item_hash(item, f"moments:{model}:0") == "h"


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
    item = s.items.upsert_from_feed(source(s), entry("tags"), keep_excerpt=False)
    s.items.store_full_text(item, "Intro\nLag\nbody")
    tag_input = s.tags.input(item)
    assert tag_input is not None and tag_input.full_text == "Intro\nLag\nbody"
    assert tag_input.sessions == []  # ADR-0058: an article is tagged whole
    result = TagResult(
        Tags("intermediate", frozenset({"cg-lag", "cg-replication"})), {}
    )
    s.tags.save(item, result, "small-model", 1)
    assert s.tags.version(item) == 1
    assert probe.item_tags(item) == result.item
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
    assert probe.item_tags(item) == result.item
    # A new prompt version replaces the tags.
    again = TagResult(Tags("beginner", frozenset({"cg-replication"})), {})
    s.tags.save(item, again, "small-model", 2)
    assert probe.item_tags(item) == again.item
    assert s.tags.version(item) == 2


def test_tag_reads_respect_rights_and_saves_refuse_per_section_tags(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    item = s.items.upsert_from_feed(source(s), entry("rights"), keep_excerpt=False)
    s.items.store_full_text(item, "body")
    assert s.tags.find("https://contract.example.test/rights") == item
    assert s.tags.needs_tagging(item, 1) is True
    sections = TagResult(
        Tags("beginner", frozenset()), {7: Tags("beginner", frozenset())}
    )
    with pytest.raises(ValueError, match="whole"):
        s.tags.save(item, sections, "m", 1)
    s.tags.save(item, TagResult(Tags("beginner", frozenset()), {}), "m", 1)
    assert s.tags.needs_tagging(item, 1) is False
    assert s.tags.needs_tagging(item, 2) is True
    # Lowered to excerpt: the stored body is purged and never read for tagging.
    change_profile(s, "full_text_internal", "excerpt")
    tag_input = s.tags.input(item)
    assert tag_input is not None and tag_input.full_text is None


# DB-3 embeddings (P1-W3-S04): one query filters by rights, source and difficulty.
def unit(*first: float) -> list[float]:
    return [*first, *([0.0] * (1024 - len(first)))]


# ADR-0058: one vector per article.
def test_similar_articles_filter_by_rights_source_and_difficulty(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    a, b = dup_source(s, "emb-a"), dup_source(s, "emb-b")
    item_a = dup_item(s, a, "emb1", 2)
    item_a2 = dup_item(s, a, "emb1b", 3)
    item_b = dup_item(s, b, "emb2", 4)
    for item in (item_a, item_a2, item_b):
        s.items.store_full_text(item, "body")
    assert s.embeddings.missing(item_a, "voyage-3.5") is True
    s.embeddings.save(item_a, unit(1, 0), "voyage-3.5")
    s.embeddings.save(item_a2, unit(0.7, 0.7), "voyage-3.5")
    s.embeddings.save(item_b, unit(0.9, 0.1), "voyage-3.5")
    assert s.embeddings.missing(item_a, "voyage-3.5") is False
    assert s.embeddings.missing(item_a, "voyage-3-large") is True
    s.tags.save(item_a, TagResult(Tags("advanced", frozenset()), {}), "m", 1)
    s.tags.save(item_a2, TagResult(Tags("beginner", frozenset()), {}), "m", 1)
    query = unit(1, 0)
    ours = {item_a, item_a2, item_b}
    hits = [h.item_id for h in s.embeddings.similar(query, 50) if h.item_id in ours]
    assert hits == [item_a, item_b, item_a2]  # nearest first
    # Vectors from another model aren't comparable, so they never match (P1-W4-S02).
    other = s.embeddings.similar(query, 50, model="voyage-3-large")
    assert not [h for h in other if h.item_id in ours]
    vector = s.embeddings.vector(item_b, "voyage-3.5")
    assert vector is not None and vector[:2] == [0.9, 0.1]
    assert s.embeddings.vector(item_b, "voyage-3-large") is None
    by_source = s.embeddings.similar(query, 50, source_ids=[b])
    assert [h.item_id for h in by_source] == [item_b]
    by_level = s.embeddings.similar(query, 50, difficulties=["beginner"])
    assert [h.item_id for h in by_level if h.item_id in ours] == [item_a2]
    # A broken link (P1-W6-S03) is never offered as similar; it comes back once fixed.
    s.items.set_link_broken(item_b, datetime(2026, 10, 26, tzinfo=UTC))
    assert item_b not in {h.item_id for h in s.embeddings.similar(query, 50)}
    s.items.set_link_broken(item_b, None)
    assert item_b in {h.item_id for h in s.embeddings.similar(query, 50)}
    # An admin's correction of an article's level wins (P1-W3-S05).
    probe.override_level(item_a2, "advanced")
    by_level = s.embeddings.similar(query, 50, difficulties=["beginner"])
    assert [h.item_id for h in by_level if h.item_id in ours] == []
    # Lowering a source's rights clears its vectors (ING-2).
    s.sources.upsert(
        name="dup-emb-b",
        feed_url="https://dup-emb-b.example.test/feed.xml",
        rights_profile="excerpt",
        homepage=None,
    )
    assert s.embeddings.similar(query, 50, source_ids=[b]) == []
    assert s.embeddings.vector(item_b, "voyage-3.5") is None
    assert s.embeddings.missing(item_b, "voyage-3.5") is False  # no text to embed


def test_a_duplicate_or_textless_item_never_needs_embedding(
    store: tuple[Store, Probe],
) -> None:
    s, _ = store
    url = "https://dup.example.test/emb-dup"
    a, b = dup_source(s, "emb-d1"), dup_source(s, "emb-d2")
    primary, copy = dup_item(s, a, "ed1", 1, url=url), dup_item(s, b, "ed2", 2, url=url)
    assert s.embeddings.missing(primary, "voyage-3.5") is False  # no text yet
    s.items.store_full_text(primary, "p")
    s.items.store_full_text(copy, "c")
    s.items.link_duplicates(copy)
    assert s.embeddings.missing(primary, "voyage-3.5") is True
    assert s.embeddings.missing(copy, "voyage-3.5") is False


def test_re_ingesting_leaves_the_admins_overrides_alone(
    conn: psycopg.Connection,
) -> None:
    # P1-W3-S05: re-ingesting an article leaves an admin's correction alone.
    s = PostgresStore(conn)
    sid = source(s)
    item = s.items.upsert_from_feed(sid, entry("survive"), keep_excerpt=False)
    conn.execute(
        "insert into tag_override (content_item_id, difficulty, concepts, "
        "updated_by) values (%s, 'advanced', '{}', 'admin')",
        (item,),
    )
    s.items.upsert_from_feed(sid, entry("survive"), keep_excerpt=False)
    s.tags.save(item, TagResult(Tags("beginner", frozenset()), {}), "m", 1)
    rows = conn.execute(
        "select count(*) from tag_override where content_item_id = %s", (item,)
    ).fetchone()
    assert rows == (1,)


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


def test_readers_return_preferences_feedback_and_topic_articles(
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
    by_tag = dup_item(s, plain, "rd1", 3)
    by_correction = dup_item(s, plain, "rd2", 2)
    off_topic = dup_item(s, plain, "rd3", 1)
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
    rows = s.ranking.topic_articles(
        ["databases"], 1000, exclude_sources=set(), exclude_items=set()
    )
    assert [r.item_id for r in rows if r.item_id in mine] == [by_tag, by_correction]
    # P2-W12-S04: by a project's concepts, the admin's correction winning too.
    rows = s.ranking.concept_articles(
        frozenset({"rd-index"}), 1000, exclude_sources=set(), exclude_items={by_tag}
    )
    assert [r.item_id for r in rows if r.item_id in mine] == [by_correction]
    assert (
        s.ranking.concept_articles(
            frozenset(), 10, exclude_sources=set(), exclude_items=set()
        )
        == []
    )

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
    rows = s.ranking.topic_articles(
        ["databases"], 1000, exclude_sources={plain}, exclude_items=set()
    )
    assert not [r for r in rows if r.item_id in mine]


def test_topic_articles_offer_the_shown_copy_of_active_sources_in_order(
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
    full = dup_source(s, "tm-full")
    original = dup_item(s, full, "tm1", 1, url=url)
    copy = dup_item(s, dup_source(s, "tm-copy"), "tm2", 2, url=url)
    s.items.link_duplicates(copy)
    newer = dup_item(s, full, "tm3", 5)
    emptied = dup_item(s, full, "tm4", 4)
    for item in (original, copy, newer, emptied):
        s.tags.save(
            item, TagResult(Tags("beginner", frozenset({"tm-idx"})), {}), "m", 1
        )
    probe.correct_concepts(emptied, [])  # an admin removed every concept: no match

    def offered(limit: int = 1000) -> list[int]:
        rows = s.ranking.topic_articles(
            ["databases"], limit, exclude_sources=set(), exclude_items=set()
        )
        mine = {original, copy, newer, emptied}
        return [r.item_id for r in rows if r.item_id in mine]

    # One card per story: the earliest copy, the one tagged and embedded. Newest first.
    assert offered() == [newer, original]
    assert (
        s.ranking.topic_articles([], 10, exclude_sources=set(), exclude_items=set())
        == []
    )
    # A broken link (P1-W6-S03) is never offered, and comes back once it works; the
    # story's other copy stands in meanwhile.
    when = datetime(2026, 10, 26, tzinfo=UTC)
    s.items.set_link_broken(newer, when)
    s.items.set_link_broken(original, when)
    assert offered() == [copy]
    s.items.set_link_broken(newer, None)
    s.items.set_link_broken(original, None)
    assert offered() == [newer, original]
    s.sources.sync([seed("other-only")])  # both leave the seed list: inactive
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


def test_article_facts_and_feedback_for_scoring(store: tuple[Store, Probe]) -> None:
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
    item = dup_item(s, sid, "sf1", 7)
    disliked = dup_item(s, sid, "sf2", 6)
    s.tags.save(item, TagResult(Tags("beginner", frozenset({"sf-a"})), {}), "m", 1)
    s.tags.save(disliked, TagResult(Tags("beginner", frozenset({"sf-b"})), {}), "m", 1)
    facts = s.ranking.article_facts([item])
    assert facts[item].difficulty == "beginner"
    assert facts[item].concepts == frozenset({"sf-a"})
    assert facts[item].minutes is None  # no stored sections
    # Topics: the source's seed topics plus the topics of the item's concepts.
    assert facts[item].topics == frozenset({"databases"})
    assert facts[item].quality is None and facts[item].source_id == sid
    assert facts[item].published_at == datetime(2099, 11, 7, tzinfo=UTC)
    # Owner, 2026-10-26: an admin's correction beats the model's tag.
    probe.override_level(item, "advanced")
    assert s.ranking.article_facts([item])[item].difficulty == "advanced"
    assert s.ranking.article_facts([10**12]) == {}
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
    """A user whose feed holds the item (feeds are per user, W4-S04)."""
    user = f"feed-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    s.feed.replace_user(
        user, [RankedEntry(item_id, "topic_match", None)], datetime.now(UTC)
    )
    return user


# CACHE-1, Q-P1-17 (P1-W4-S04): a user's feed is replaced whole, one list of articles
# (ADR-0058), with its time.
def test_a_users_feed_is_replaced_whole_with_its_time(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    first = s.items.upsert_from_feed(sid, entry("uf0"), keep_excerpt=False)
    second = s.items.upsert_from_feed(sid, entry("uf1"), keep_excerpt=False)
    user = f"feed-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    assert probe.feed_state(user) is None
    early = datetime(2099, 1, 1, tzinfo=UTC)
    s.feed.replace_user(
        user,
        [
            RankedEntry(first, "quality", None),
            RankedEntry(second, "topic_match", None),
        ],
        early,
    )
    assert probe.feed_entries(user) == [first, second]
    later = datetime(2099, 1, 2, tzinfo=UTC)
    s.feed.replace_user(user, [RankedEntry(second, "freshness", None)], later)
    assert probe.feed_entries(user) == [second]
    assert probe.feed_state(user) == later
    # An empty feed still counts as computed (ADR-0008: "not yet" vs "nothing").
    s.feed.replace_user(user, [], later)
    assert probe.feed_entries(user) == []
    assert probe.feed_state(user) == later


def test_starter_feeds_are_replaced_per_topic_and_level(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    sid = source(s)
    a = s.items.upsert_from_feed(sid, entry("sf0"), keep_excerpt=False)
    b = s.items.upsert_from_feed(sid, entry("sf1"), keep_excerpt=False)
    s.feed.replace_starter("databases", "beginner", [RankedEntry(a, "q", None)])
    s.feed.replace_starter("databases", "advanced", [RankedEntry(b, "q", None)])
    s.feed.replace_starter(
        "databases",
        "beginner",
        [RankedEntry(b, "quality", None), RankedEntry(a, "quality", None)],
    )
    assert probe.starter_ids("databases", "beginner") == [b, a]
    assert probe.starter_ids("databases", "advanced") == [b]


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
    item = s.items.upsert_from_feed(source(s), entry("kept"), keep_excerpt=False)
    user = f"feed-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    first = datetime(2099, 1, 1, tzinfo=UTC)
    s.feed.replace_user(user, [RankedEntry(item, "quality", None)], first)
    twice = [
        RankedEntry(item, "quality", None),
        RankedEntry(item, "freshness", None),
    ]
    with pytest.raises(Exception):  # noqa: B017  the engine's own error
        s.feed.replace_user(user, twice, datetime(2099, 1, 2, tzinfo=UTC))
    assert probe.feed_entries(user) == [item]
    assert probe.feed_state(user) == first


def test_a_feed_for_a_deleted_user_or_item_is_skipped(
    store: tuple[Store, Probe],
) -> None:
    # A user purged or an item gone between ranking and writing is not a failure (it
    # would otherwise retry and count as one).
    s, probe = store
    item = s.items.upsert_from_feed(source(s), entry("gone"), keep_excerpt=False)
    now = datetime(2099, 1, 1, tzinfo=UTC)
    s.feed.replace_user("never-existed", [RankedEntry(item, "q", None)], now)
    assert probe.feed_state("never-existed") is None
    user = f"feed-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    gone = item + 10_000_000
    s.feed.replace_user(
        user,
        [RankedEntry(gone, "quality", None), RankedEntry(item, "topic_match", None)],
        now,
    )
    assert probe.feed_entries(user) == [item]
    assert probe.feed_state(user) == now


# Articles of any profile (§3.2, Q-P1-39, ADR-0058).
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
    original = dup_item(s, full, "ta2", 2, url=url)
    s.items.link_duplicates(original)
    solo = dup_item(s, dup_source(s, "ta-meta", "metadata_only"), "ta3", 3)
    for item in (listing, original, solo):
        s.tags.save(
            item, TagResult(Tags("beginner", frozenset({"ta-idx"})), {}), "m", 1
        )

    def offered(exclude: set[int]) -> list[int]:
        rows = s.ranking.topic_articles(
            ["databases"], 1000, exclude_sources=set(), exclude_items=exclude
        )
        return [r.item_id for r in rows if r.item_id in {listing, original, solo}]

    # One card per story, the earliest copy (the earlier listing here); a
    # metadata-only article on its own is offered too. Newest first.
    assert offered(set()) == [solo, listing]
    assert offered({solo}) == [listing]
    # A broken link (P1-W6-S03) hands the story to a working copy.
    s.items.set_link_broken(listing, datetime(2026, 10, 26, tzinfo=UTC))
    assert offered(set()) == [solo, original]
    s.items.set_link_broken(listing, None)
    assert offered(set()) == [solo, listing]


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
    assert facts[bare].minutes is None  # no body text: length unknown (Q-P1-39)


# Exploration outcomes (REC-4, P1-W4-S09): written by Week 5, read by ranking.
def test_arm_outcomes_are_read_as_stored(store: tuple[Store, Probe]) -> None:
    s, probe = store
    probe.record_arm(Arm("topic", "contract-backend"), shown=10, finished=4)
    outcomes = s.ranking.arm_outcomes()
    assert outcomes[Arm("topic", "contract-backend")] == ArmOutcome(10, 4)


# P1-W5-S03: finished articles, which candidates leave out.
def test_finished_reads_articles(store: tuple[Store, Probe]) -> None:
    s, probe = store
    item = s.items.upsert_from_feed(source(s), entry("fin"), keep_excerpt=False)
    user = f"fin-{uuid4().hex[:8]}"
    probe.add_user(user, False, [])
    assert s.ranking.finished(user) == frozenset()
    probe.finish(user, item)
    assert s.ranking.finished(user) == frozenset({item})


# The question bank (Q-1, Q-P2-09, P2-W8-S01, ADR-0058): tagged full-text articles are
# targets; drafts replace an article's questions.
DRAFT = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")


def _question_item(s: Store, probe: Probe) -> tuple[int, list[int], int]:
    """Three full-text articles: "intro" untagged, "lag" and "quorum" tagged; the
    first, all three, and their source."""
    probe.reset_concepts()
    sync_concepts(s, graph(1, CHAIN))
    sid = source(s)
    tagged: dict[str, Tags | None] = {
        "intro": None,
        "lag": Tags("advanced", frozenset({"cg-lag", "cg-replication"})),
        "quorum": Tags("advanced", frozenset({"cg-quorum"})),
    }
    ids: list[int] = []
    for name, tags in tagged.items():
        item = s.items.upsert_from_feed(
            sid, entry(f"questions-{name}"), keep_excerpt=False
        )
        s.items.store_full_text(item, f"{name} body")
        s.items.replace_sections(
            item, [Section(None, None, None, 30), Section(name, 2, None, 300)]
        )
        if tags is not None:
            s.tags.save(item, TagResult(tags, {}), "small-model", 1)
        ids.append(item)
    return ids[0], ids, sid


def test_tagged_full_text_articles_are_question_targets(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (intro, lag, quorum), _ = _question_item(s, probe)
    target = s.questions.target(lag)
    assert target is not None and target.item_id == lag
    assert target.concepts == (("cg-lag", "Lag"), ("cg-replication", "Replication"))
    assert target.sections == 2  # its stored heading sections size its questions
    assert s.questions.target(intro) is None  # untagged
    assert s.questions.targets(lag) == [lag]
    assert s.questions.targets(intro) == []
    assert {lag, quorum} <= set(s.questions.targets(None))
    # An admin's correction replaces the model's tags.
    probe.correct_concepts(quorum, ["cg-ryw"])
    corrected = s.questions.target(quorum)
    assert corrected is not None and corrected.concepts == (("cg-ryw", "RYW"),)
    # A source that no longer allows full text makes none of them targets (ING-2).
    change_profile(s, "full_text_internal", "excerpt")
    assert s.questions.target(lag) is None


def test_an_article_with_questions_carried_from_its_moments_is_drafted_already(
    store: tuple[Store, Probe],
) -> None:
    # ADR-0058 folded each moment's questions into its article (from_moments): those
    # are its questions now, never retired by a redraft.
    s, probe = store
    _, (_, lag, quorum), _ = _question_item(s, probe)
    carried = probe.carry_over_question(lag)
    assert s.questions.target(lag) is not None  # still validated against its text
    assert lag not in s.questions.targets(None)
    assert s.questions.targets(lag) == []
    assert quorum in s.questions.targets(None)
    assert s.questions.drafted_hash(lag) is None  # drafted from a moment, not whole
    assert s.questions.pending(carried) == (lag, DRAFT)
    # A stray draft never retires them.
    with pytest.raises(ValueError, match="keeps its moments"):
        s.questions.save(lag, [DRAFT, DRAFT], ["cg-lag"], "m", 1, "h", None)
    with pytest.raises(ValueError, match="keeps its moments"):
        s.questions.save_estimate(lag, None, ["cg-lag"], "m", "e", None)
    assert s.questions.pending(carried) == (lag, DRAFT)


def test_an_article_whose_moments_had_an_estimate_drafted_is_drafted_already(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, quorum), _ = _question_item(s, probe)
    probe.carry_over_estimate(lag)
    assert lag not in s.questions.targets(None)
    assert quorum in s.questions.targets(None)
    assert s.questions.estimate_drafted_hash(lag) is None  # a moment's, not whole
    with pytest.raises(ValueError, match="keeps its moments"):
        s.questions.save_estimate(lag, None, ["cg-lag"], "m", "e", None)
    with pytest.raises(ValueError, match="keeps its moments"):
        s.questions.save(lag, [DRAFT, DRAFT], ["cg-lag"], "m", 1, "h", None)


def test_drafts_replace_an_articles_questions_and_remember_their_hash(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, _), _ = _question_item(s, probe)
    assert s.questions.drafted_hash(lag) is None
    first = s.questions.save(lag, [DRAFT, DRAFT], ["cg-lag"], "m", 1, "h1", None)
    assert len(first) == 2 and s.questions.drafted_hash(lag) == "h1"
    again = s.questions.save(lag, [DRAFT, DRAFT], ["cg-lag"], "m", 1, "h2", None)
    assert set(again).isdisjoint(first) and s.questions.drafted_hash(lag) == "h2"
    # Each takes the article's next slot; the retired keep theirs.
    assert probe.question_slots(lag) == [0, 1, 2, 3]


def test_a_verdict_makes_a_pending_question_live_or_rejected_once(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, _), _ = _question_item(s, probe)
    draft = DRAFT
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


# Owner, 2026-11-23 (`rewrite-stems`): a live question's stem rewritten to stand alone.
def test_a_live_questions_stem_is_rewritten_once_keeping_the_rest(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, _), _ = _question_item(s, probe)
    draft = QuestionDraft("Per the passage, why lag?", ("a", "b", "c", "d"), 2, "Lag")
    live, pending = s.questions.save(
        lag, [draft, draft], ["cg-lag"], "m", 1, "h1", None
    )
    s.questions.record_verdict(live, "v", 2)
    # A local database may hold real questions: only this test's are looked at.
    mine = [
        c for c in s.questions.stem_candidates() if c.question_id in (live, pending)
    ]
    assert mine == [StemCandidate(live, lag, draft, None)]
    # Only with the stem it was read with, and only while live.
    assert not s.questions.rewrite_stem(live, "Why?", "Why does lag?", "r", 1001, 2)
    assert not s.questions.rewrite_stem(pending, draft.stem, "Why lag?", "r", 1001, 2)
    assert s.questions.rewrite_stem(live, draft.stem, "Why lag?", "r", 1001, 2)
    assert not s.questions.rewrite_stem(live, draft.stem, "Again?", "r", 1001, 2)
    (rewritten,) = [c for c in s.questions.stem_candidates() if c.question_id == live]
    assert (rewritten.draft, rewritten.tried_at is not None) == (
        replace(draft, stem="Why lag?"),
        True,
    )
    # The drafting model stays (it wrote the options and key); the rewrite's prompt.
    assert probe.question_writers(live) == ("m", 1001, "r")
    sample = [q for q in s.questions.summary(100_000).sample if q.question_id == live]
    assert [(q.validator_answer, q.status) for q in sample] == [(2, "live")]


def test_a_live_estimates_stem_is_rewritten_and_a_try_is_remembered(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, _), _ = _question_item(s, probe)
    estimate = EstimateDraft("Per the text, how many ms?", 40, "ms", "lag of 40 ms")
    eid = s.questions.save_estimate(lag, estimate, ["cg-lag"], "m", "e1", None)
    assert eid is not None
    s.questions.record_estimate_verdict(eid, "v", 41, True)

    def mine() -> StemCandidate:
        return next(c for c in s.questions.stem_candidates() if c.question_id == eid)

    assert mine() == StemCandidate(eid, lag, estimate, None)
    s.questions.mark_stem_tried(eid)
    assert mine().tried_at is not None and mine().draft == estimate
    # Not as a multiple-choice question: the kind must match.
    assert not s.questions.rewrite_stem(
        eid, estimate.stem, "How many ms?", "r", 1001, 1
    )
    assert s.questions.rewrite_estimate_stem(
        eid, estimate.stem, "How many ms of lag?", "r", 1001, 39
    )
    assert mine().draft == replace(estimate, stem="How many ms of lag?")
    assert probe.question_writers(eid) == ("m", 1001, "r")


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


# Q-3, Q-P2-11 (P2-W8-S04): a question starts at its article's level, an admin's
# correction winning.
def test_a_question_starts_at_its_articles_difficulty(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, quorum), _ = _question_item(s, probe)
    target = s.questions.target(lag)
    assert target is not None and target.difficulty == "advanced"
    probe.override_level(quorum, "beginner")
    corrected = s.questions.target(quorum)
    assert corrected is not None and corrected.difficulty == "beginner"
    draft = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")
    (first, _) = s.questions.save(
        lag, [draft, draft], ["cg-lag"], "m", 1, "h1", target.difficulty
    )
    assert probe.question_difficulty(first) == "advanced"


# P3-W13-S03b: an article's estimate is drafted, held and validated apart from its
# multiple-choice questions, and neither kind retires the other.
def test_an_articles_estimate_lives_beside_its_multiple_choice(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    before = set(s.questions.pending_questions())
    held_articles, _ = s.questions.in_open_batches()
    _, (_, lag, _), _ = _question_item(s, probe)
    choice = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")
    estimate = EstimateDraft("How many ms?", 40, "ms", "lag of 40 ms")
    assert s.questions.estimate_drafted_hash(lag) is None
    choices = s.questions.save(lag, [choice, choice], ["cg-quorum"], "m", 1, "h", None)
    first = s.questions.save_estimate(lag, estimate, ["cg-quorum"], "m", "e1", None)
    assert first is not None
    assert s.questions.estimate_drafted_hash(lag) == "e1"
    assert s.questions.drafted_hash(lag) == "h"
    assert s.questions.pending_ids(lag) == choices  # multiple choice only
    assert s.questions.pending(first) is None
    assert s.questions.pending_estimate(first) == (lag, estimate)
    assert s.questions.pending_estimate(choices[0]) is None
    assert [q for q in s.questions.pending_questions() if q not in before] == [
        (choices[0], "choice"),
        (choices[1], "choice"),
        (first, "estimate"),
    ]
    # Redrafting multiple choice leaves the estimate; an estimate's verdict needs it.
    again = s.questions.save(lag, [choice], ["cg-quorum"], "m", 1, "h2", None)
    assert s.questions.pending_estimate(first) == (lag, estimate)
    assert s.questions.record_verdict(first, "v", 2) is False
    assert s.questions.record_estimate_verdict(again[0], "v", 40, True) is False
    assert s.questions.record_estimate_verdict(first, "v", 45, True) is True
    assert s.questions.record_estimate_verdict(first, "v", 45, True) is False
    assert s.questions.pending_estimate(first) is None
    assert s.questions.pending_ids(lag) == again
    # A redraft stating no number retires the estimate and is remembered (AI-4).
    assert s.questions.save_estimate(lag, None, ["cg-quorum"], "m", "e2", None) is None
    assert s.questions.estimate_drafted_hash(lag) == "e2"
    assert s.questions.pending_ids(lag) == again
    # A batch item knows its kind.
    entry = QuestionBatchEntry(f"estimate-{lag}", lag, None, "e3", "estimate")
    s.questions.record_batch("b-est", "draft", "m", [entry])
    assert s.questions.batch_entries("b-est") == [entry]
    articles, _ = s.questions.in_open_batches()
    assert articles - held_articles == {(lag, "estimate")}
    s.questions.close_batch("b-est", "failed", {})


# Q-P2-13 (P2-W8-S05): batches remember what each request was for; an open batch
# holds its articles and questions; broken replies count per article.
def test_question_batches_hold_their_items_until_closed_and_count_broken_replies(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    # A local database may already hold real pending questions.
    before = set(s.questions.pending_questions())
    held_articles, held_questions = s.questions.in_open_batches()

    def open_ours() -> list[tuple[str, str]]:
        return [(b, k) for b, k, _ in s.questions.open_batches() if b in ("b1", "b2")]

    def in_ours() -> tuple[set[tuple[int, QuestionKind]], set[int]]:
        articles, questions = s.questions.in_open_batches()
        return articles - held_articles, questions - held_questions

    item, (_, lag, quorum), _ = _question_item(s, probe)
    draft = DRAFT
    (pending, _) = s.questions.save(
        quorum, [draft, draft], ["cg-quorum"], "m", 1, "h1", None
    )
    assert [
        q for q, _ in s.questions.pending_questions() if (q, "choice") not in before
    ] == sorted(s.questions.pending_ids(quorum))
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
    assert in_ours() == ({(lag, "choice"), (quorum, "choice")}, {pending})
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
    broken_articles, broken_questions = s.questions.broken_counts()
    assert {k: n for k, n in broken_articles.items() if k[0] in (lag, quorum)} == {
        (lag, "h-lag"): 1
    }
    assert pending not in broken_questions
    # A failed batch frees its items without results.
    s.questions.close_batch("b2", "failed", {})
    assert open_ours() == []
    assert in_ours() == (set(), set())

    # Q-P2-46: project notes ride a batch; their items are listed, held while it's
    # open, closed with it, and its kind's last submission is known.
    probe.add_user("note-rider", False, [])
    note = NoteBatchEntry("note-0-1", "note-rider", item, ("octo/velox",), 2)
    s.questions.record_batch("b3", "draft", "haiku", [], [note])
    assert s.questions.note_entries("b3") == [note]
    assert ("note-rider", item) in s.questions.notes_in_open_batches()
    last = s.questions.last_submitted("draft")
    assert last is not None and last.tzinfo is not None
    s.questions.close_batch("b3", "completed", {note.custom_id: "saved"})
    assert ("note-rider", item) not in s.questions.notes_in_open_batches()


# Q-3 (P2-W9-S08): the weekly recalibration reads the answers, stores levels, and
# queues anomalies for review.
def test_calibration_reads_answers_saves_levels_and_queues_anomalies_once(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, quorum), _ = _question_item(s, probe)
    draft = QuestionDraft("Why lag?", ("a", "b", "c", "d"), 2, "Lag")
    a, b = s.questions.save(lag, [draft, draft], ["cg-lag"], "m", 1, "h1", None)
    (gone, _) = s.questions.save(
        quorum, [draft, draft], ["cg-quorum"], "m", 1, "h1", None
    )
    for qid in (a, b, gone):
        s.questions.record_verdict(qid, "v", 2)  # live
    for user in ("cal-1", "cal-2"):
        probe.add_user(user, False, [])
    probe.add_answer("cal-1", a, True)
    probe.add_answer("cal-2", a, False)
    probe.add_answer("cal-1", b, True)
    probe.add_answer("cal-2", gone, True)
    probe.add_answer("cal-2", b, False, review=True)  # a review: left out
    probe.retire_question(gone)
    got = s.questions.calibration_answers()
    # Live (and flagged) questions' answers; a retired one's are left out.
    assert sorted(
        (x.person, x.item, x.correct) for x in got if x.item in (a, b, gone)
    ) == [("cal-1", a, True), ("cal-1", b, True), ("cal-2", a, False)]
    assert s.questions.save_levels({a: "advanced", b: "beginner"}) == 2
    assert probe.question_difficulty(a) == "advanced"
    assert probe.question_difficulty(b) == "beginner"
    assert probe.question_calibrated(a) and probe.question_calibrated(b)
    assert not probe.question_calibrated(gone)
    # Once per question: queued, then not again while open or after a decision.
    assert s.questions.queue_anomalies([a]) == 1
    assert s.questions.queue_anomalies([a]) == 0
    assert (a, "anomaly", False) in probe.reviews()
    probe.decide_review(a)
    assert s.questions.queue_anomalies([a]) == 0
    # A question already waiting for another review isn't queued twice.
    probe.flag_question(b)
    s.questions.queue_spot_checks(datetime.now(UTC) + timedelta(days=1), 0.0)
    assert s.questions.queue_anomalies([b]) == 0


# §5F, Q-P2-22 (P2-W10-S01): what a path can be proposed from, and saving a draft.
def test_paths_read_coverage_prerequisites_and_candidates_and_save_drafts(
    store: tuple[Store, Probe],
) -> None:
    s, probe = store
    _, (_, lag, quorum), sid = _question_item(s, probe)
    s.items.set_frameable(lag, True)
    (live, _) = s.questions.save(lag, [DRAFT, DRAFT], ["cg-lag"], "m", 1, "h1", None)
    s.questions.record_verdict(live, "v", 2)
    cover = {c.slug: c for c in s.paths.coverage()}
    assert (cover["cg-lag"].articles, cover["cg-lag"].sources) == (1, 1)
    assert cover["cg-replication"].articles == 1
    assert cover["cg-quorum"].articles == 1
    assert cover["cg-ryw"].articles == 0  # known, nothing to read
    assert (
        cover["cg-lag"].name == "Lag" and cover["cg-lag"].topic == "distributed-systems"
    )
    prerequisites = s.paths.prerequisites()
    assert {("cg-replication", "cg-lag"), ("cg-lag", "cg-ryw")} <= prerequisites
    assert not any("cg-quorum" in pair for pair in prerequisites)  # related only
    found = {c.item_id: c for c in s.paths.session_candidates(["cg-lag", "cg-quorum"])}
    assert found[lag] == SessionCandidate(
        lag, frozenset({"cg-lag", "cg-replication"}), sid, True, True
    )
    assert found[quorum].live_questions is False
    # A live estimate alone gives a checkpoint nothing to ask (P3-W13-S03b).
    estimate = EstimateDraft("How many?", 3, "replicas", "three replicas")
    eid = s.questions.save_estimate(quorum, estimate, ["cg-quorum"], "m", "e", None)
    assert eid is not None
    s.questions.record_estimate_verdict(eid, "v", 3, True)
    assert not next(
        c for c in s.paths.session_candidates(["cg-quorum"]) if c.item_id == quorum
    ).live_questions
    # An admin's correction replaces the model's tags.
    probe.correct_concepts(quorum, ["cg-ryw"])
    assert quorum not in {c.item_id for c in s.paths.session_candidates(["cg-quorum"])}
    assert {c.slug: c.articles for c in s.paths.coverage()}["cg-ryw"] == 1
    pid = s.paths.save_draft(
        PathDraft(
            "Replication basics",
            "Why replicas fall behind.",
            (
                DraftSection(("cg-replication", "cg-lag"), (lag,)),
                DraftSection(("cg-ryw",), (quorum,)),
            ),
        ),
        "m",
        1,
    )
    # ADR-0058: sessions are articles.
    assert probe.path(pid) == (
        "draft",
        "Replication basics",
        [(("cg-lag", "cg-replication"), (lag,)), (("cg-ryw",), (quorum,))],
    )
    # A source that no longer allows full text has nothing to read (ING-2).
    change_profile(s, "full_text_internal", "excerpt")
    assert {c.slug: c.articles for c in s.paths.coverage()}["cg-lag"] == 0
    assert s.paths.session_candidates(["cg-lag"]) == []
