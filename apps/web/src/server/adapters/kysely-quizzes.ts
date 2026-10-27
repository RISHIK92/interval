import type { DB } from "@interval/db";
import { type Kysely, type RawBuilder, sql } from "kysely";
import {
  QUIZ_SECONDS,
  type QuizQuestion,
  type Quizzes,
  quizKey,
} from "../ports";
import { fsrsState, rate } from "../reviews";

// The last answer in flight when the clock runs out still counts (Q-P2-14).
const GRACE = sql.raw(`interval '5 seconds'`);
const DURATION = sql.raw(`interval '${String(QUIZ_SECONDS)} seconds'`);
const RIGHT = 0.3;
const WRONG = 0.7;
const PRACTICED = 0.5;
const MASTERED = 0.85;

// Live questions in moments their source's rights allow (Q-1, ING-2), as `q` and `m`.
const LIVE = sql`
  question q
  join moment m on m.id = q.moment_id
  join content_item ci on ci.id = m.content_item_id
  join source s on s.id = ci.source_id
   and s.moments_enabled
   and s.rights_profile in ('full_text_internal', 'full_text_display')
`;

// Q-P2-15: a right answer moves p by 0.3(1 - p); a wrong one leaves 0.7p. `done` is the answer statement's own row (none for a repeat).
const moved = (p: RawBuilder<unknown>) => sql`
  case when (select correct from done)
    then ${p} + ${RIGHT}::float8 * (1 - ${p})
    else ${WRONG}::float8 * ${p}
  end`;

// Practiced at 0.5; mastered at 0.85 with right answers on two UTC days (owner,
// 2026-10-28: any quiz's answers count). The statement can't see the answer it is
// recording, so today joins the days when this answer is right.
// shortcut: the days come from the statement's snapshot, so a right answer on another
// UTC day committing at the same moment is missed; only across midnight, and the next
// right answer counts it. Lock the user's answers if that ever matters.
const stateOf = (
  p: RawBuilder<unknown>,
  conceptId: RawBuilder<unknown>,
  userId: string,
) => sql`
  (case
    when ${p} >= ${MASTERED}::float8 and (
      select count(distinct day) from (
        select (qa.answered_at at time zone 'UTC')::date as day
        from quiz_answer qa
        join quiz_attempt a on a.id = qa.attempt_id and a.user_id = ${userId}
        join question_concept qc
          on qc.question_id = qa.question_id and qc.concept_id = ${conceptId}
        where qa.correct
        union
        select (now() at time zone 'UTC')::date where (select correct from done)
      ) days
    ) >= 2 then 'mastered'
    when ${p} >= ${PRACTICED}::float8 then 'practiced'
    else 'explored'
  end)::learner_state`;

// Kysely can't nest transactions: inside one (as the tests run), use it.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

// P2-W9-S04 (PER-2, Q-P2-16): each live concept the attempt's answered questions test
// gets one FSRS rating: Good when all its answers were right, Again when any was
// wrong. Cards are locked in concept order, like mastery's rows.
async function rateConcepts(
  trx: Kysely<DB>,
  userId: string,
  attemptId: string,
  now: Date,
): Promise<void> {
  const results = await trx
    .selectFrom("quiz_answer as qa")
    .innerJoin("question_concept as qc", "qc.question_id", "qa.question_id")
    .innerJoin("concept as c", "c.id", "qc.concept_id")
    .select([
      "qc.concept_id",
      sql<boolean>`bool_and(qa.correct)`.as("all_right"),
    ])
    .where("qa.attempt_id", "=", attemptId)
    .where("qa.answered_at", "is not", null)
    .where("c.retired_at", "is", null)
    .groupBy("qc.concept_id")
    .orderBy("qc.concept_id")
    .execute();
  if (results.length === 0) return;
  // Two of the user's quizzes finishing at once would both read "no card" for a new
  // concept: one at a time per user, for this transaction.
  await sql`select pg_advisory_xact_lock(hashtext(${`concept_review:${userId}`}))`.execute(
    trx,
  );
  const existing = await trx
    .selectFrom("concept_review")
    .selectAll()
    .where("user_id", "=", userId)
    .where(
      "concept_id",
      "in",
      results.map((r) => r.concept_id),
    )
    .orderBy("concept_id")
    .forUpdate()
    .execute();
  const byConcept = new Map(existing.map((r) => [r.concept_id, r]));
  for (const { concept_id, all_right } of results) {
    const was = byConcept.get(concept_id);
    const next = rate(
      was === undefined
        ? null
        : {
            due: was.due,
            stability: was.stability,
            difficulty: was.difficulty,
            scheduledDays: was.scheduled_days,
            learningSteps: was.learning_steps,
            reps: was.reps,
            lapses: was.lapses,
            state: fsrsState(was.state),
            lastReview: was.last_review,
          },
      all_right,
      now,
    );
    const row = {
      due: next.due,
      stability: next.stability,
      difficulty: next.difficulty,
      scheduled_days: next.scheduledDays,
      learning_steps: next.learningSteps,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      last_review: next.lastReview,
    };
    await trx
      .insertInto("concept_review")
      .values({ user_id: userId, concept_id, ...row })
      .onConflict((oc) =>
        oc.columns(["user_id", "concept_id"]).doUpdateSet(row),
      )
      .execute();
  }
}

type Open = {
  question_id: string;
  stem: string;
  options: string[];
  served_at: Date;
  over: boolean;
};

export function kyselyQuizzes(db: Kysely<DB>): Quizzes {
  // The attempt's open (served, unanswered) question, with whether the clock is out.
  const open = async (attemptId: string): Promise<Open | undefined> => {
    const { rows } = await sql<Open>`
      select qa.question_id, q.stem, q.options, qa.served_at,
             (now() > a.ends_at + ${GRACE} or a.finished_at is not null) as over
      from quiz_answer qa
      join quiz_attempt a on a.id = qa.attempt_id
      join question q on q.id = qa.question_id
      where qa.attempt_id = ${attemptId} and qa.answered_at is null
    `.execute(db);
    return rows[0];
  };
  const asQuestion = (row: Open): QuizQuestion => ({
    questionId: row.question_id,
    stem: row.stem,
    options: row.options,
    servedAt: row.served_at,
  });

  return {
    start: async (userId, itemId, momentId) => {
      // Q-P2-16: a card is made by a quiz answer, so a quiz left running past its clock
      // (the tab closed before the finish) is closed at its own end and rated now.
      const stale = await db
        .selectFrom("quiz_attempt")
        .select("id")
        .where("user_id", "=", userId)
        .where("finished_at", "is", null)
        .where(sql<boolean>`ends_at + ${GRACE} < now()`)
        .execute();
      for (const { id } of stale)
        await inTransaction(db, async (trx) => {
          const closed = await trx
            .updateTable("quiz_attempt")
            .set({ finished_at: sql<Date>`ends_at` })
            .where("id", "=", id)
            .where("finished_at", "is", null)
            .returning("finished_at")
            .executeTakeFirst();
          if (closed?.finished_at != null)
            await rateConcepts(trx, userId, id, closed.finished_at);
        });
      const running = await db
        .selectFrom("quiz_attempt")
        .select(["id", "ends_at"])
        .where("user_id", "=", userId)
        .where("content_item_id", "=", itemId)
        .where((eb) =>
          momentId === null
            ? eb("moment_id", "is", null)
            : eb("moment_id", "=", momentId),
        )
        .where("finished_at", "is", null)
        .where(sql<boolean>`ends_at > now()`)
        .orderBy("started_at", "desc")
        .executeTakeFirst();
      if (running !== undefined)
        return {
          attemptId: running.id,
          endsAt: running.ends_at,
          firstTime: false,
        };
      const { rows } = await sql<{ id: string; ends_at: Date }>`
        insert into quiz_attempt (user_id, content_item_id, moment_id, ends_at)
        select ${userId}, ${itemId}, ${momentId}, now() + ${DURATION}
        where exists (
          select 1 from ${LIVE}
          where q.status = 'live' and m.content_item_id = ${itemId}
            and (${momentId}::bigint is null or m.id = ${momentId})
        )
        returning id, ends_at
      `.execute(db);
      const row = rows[0];
      return row === undefined
        ? null
        : { attemptId: row.id, endsAt: row.ends_at, firstTime: true };
    },

    next: async (userId, attemptId) => {
      const attempt = await db
        .selectFrom("quiz_attempt")
        .select(
          sql<boolean>`now() > ends_at or finished_at is not null`.as("ended"),
        )
        .where("id", "=", attemptId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (attempt === undefined) return null;
      const current = await open(attemptId);
      if (current !== undefined)
        return current.over ? "over" : asQuestion(current);
      if (attempt.ended) return "over";
      // The target's own questions in order, then live questions on the same (live)
      // concepts at random; never one already served in this attempt. A second
      // request racing this one serves nothing (one open question per attempt).
      // shortcut: order by random() over every related question; fine for a few
      // thousand questions, sample (tablesample or a precomputed list) past that.
      await sql`
        with a as (select * from quiz_attempt where id = ${attemptId}),
        own as (
          select q.id, 0 as tier, m.ordinal as mo, q.ordinal as qo, 0::float8 as r
          from ${LIVE}, a
          where q.status = 'live' and m.content_item_id = a.content_item_id
            and (a.moment_id is null or m.id = a.moment_id)
        ),
        concepts as (
          select distinct qc.concept_id from question_concept qc
          join concept c on c.id = qc.concept_id and c.retired_at is null
          where qc.question_id in (select id from own)
        ),
        related as (
          select q.id, 1, 0, 0, random()
          from ${LIVE}
          where q.status = 'live'
            and q.id not in (select id from own)
            and exists (
              select 1 from question_concept qc
              where qc.question_id = q.id
                and qc.concept_id in (select concept_id from concepts)
            )
        ),
        pick as (
          select id from (select * from own union all select * from related) c
          where id not in (
            select question_id from quiz_answer where attempt_id = ${attemptId}
          )
          order by tier, mo, qo, r
          limit 1
        )
        insert into quiz_answer (attempt_id, question_id)
        select ${attemptId}, id from pick
        on conflict do nothing
      `.execute(db);
      const served = await open(attemptId);
      return served === undefined || served.over ? "over" : asQuestion(served);
    },

    answer: async (userId, attemptId, questionId, chosen) => {
      // One statement: the answer and its question's counts together, and only for
      // the first answer (LOAD-5: a resubmission updates nothing).
      const { rows } = await sql<{
        correct: boolean;
        key: number;
        served_at: Date;
        answered_at: Date;
      }>`
        with done as (
          update quiz_answer qa
          set chosen = ${chosen}, correct = (q.correct = ${chosen}),
              answered_at = now()
          from question q, quiz_attempt a
          where qa.attempt_id = ${attemptId} and qa.question_id = ${questionId}
            and qa.answered_at is null
            and q.id = qa.question_id
            and a.id = qa.attempt_id and a.user_id = ${userId}
            and now() <= a.ends_at + ${GRACE}
            -- Not locked: an answer committing while its quiz's finish is rating can
            -- count toward mastery but not the rating. Only a racing double submit;
            -- the page finishes after the last answer's redirect.
            and a.finished_at is null
          returning qa.correct, q.correct as key, qa.served_at, qa.answered_at
        ),
        counted as (
          update question
          set answer_count = answer_count + 1,
              correct_count = correct_count + (select count(*) from done where correct)
          where id = ${questionId} and exists (select 1 from done)
        ),
        -- PER-2, Q-P2-15: quiz evidence moves each live concept the question tests
        -- strongly. p is moved from the locked row (do update), so two answers at once
        -- both count; in id order, so they lock shared rows in one order.
        mastery as (
          insert into concept_mastery
            (user_id, concept_id, probability, state, evidence_count)
          select ${userId}, qc.concept_id, ${moved(sql`0`)},
                 ${stateOf(moved(sql`0`), sql`qc.concept_id`, userId)}, 1
          from question_concept qc
          join concept c on c.id = qc.concept_id and c.retired_at is null
          where qc.question_id = ${questionId} and exists (select 1 from done)
          order by qc.concept_id
          on conflict (user_id, concept_id) do update set
            probability = ${moved(sql`concept_mastery.probability`)},
            state = ${stateOf(
              moved(sql`concept_mastery.probability`),
              sql`excluded.concept_id`,
              userId,
            )},
            evidence_count = concept_mastery.evidence_count + 1,
            updated_at = now()
        )
        select * from done
      `.execute(db);
      const first = rows[0];
      if (first !== undefined)
        return {
          correct: first.correct,
          correctOption: first.key,
          servedAt: first.served_at,
          answeredAt: first.answered_at,
          firstTime: true,
        };
      const stored = await db
        .selectFrom("quiz_answer as qa")
        .innerJoin("quiz_attempt as a", "a.id", "qa.attempt_id")
        .innerJoin("question as q", "q.id", "qa.question_id")
        .select([
          "qa.correct",
          "qa.served_at",
          "qa.answered_at",
          "q.correct as key",
        ])
        .where("qa.attempt_id", "=", attemptId)
        .where("qa.question_id", "=", questionId)
        .where("a.user_id", "=", userId)
        .executeTakeFirst();
      if (stored === undefined) return null;
      if (stored.correct === null || stored.answered_at === null) return "late";
      return {
        correct: stored.correct,
        correctOption: stored.key,
        servedAt: stored.served_at,
        answeredAt: stored.answered_at,
        firstTime: false,
      };
    },

    finish: async (userId, attemptId) => {
      // The finish and its ratings together: a quiz finished is rated exactly once.
      const finished = await inTransaction(db, async (trx) => {
        const done = await trx
          .updateTable("quiz_attempt")
          .set({ finished_at: sql<Date>`now()` })
          .where("id", "=", attemptId)
          .where("user_id", "=", userId)
          .where("finished_at", "is", null)
          .returning(["id", "finished_at"])
          .executeTakeFirst();
        if (done?.finished_at != null)
          await rateConcepts(trx, userId, attemptId, done.finished_at);
        return done;
      });
      const row = await db
        .selectFrom("quiz_attempt as a")
        .leftJoin("quiz_answer as qa", (join) =>
          join
            .onRef("qa.attempt_id", "=", "a.id")
            .on("qa.answered_at", "is not", null),
        )
        .select([
          sql<number>`count(qa.question_id)::int`.as("answered"),
          sql<number>`count(*) filter (where qa.correct)::int`.as("correct"),
        ])
        .where("a.id", "=", attemptId)
        .where("a.user_id", "=", userId)
        .groupBy("a.id")
        .executeTakeFirst();
      if (row === undefined) return null;
      return {
        answered: row.answered,
        correct: row.correct,
        firstTime: finished !== undefined,
      };
    },

    offered: async (targets) => {
      if (targets.length === 0) return new Set();
      const items = [...new Set(targets.map((t) => t.itemId))];
      // Per article: its moments with a live question; the article itself when any.
      const { rows } = await sql<{ item: string; moment: string }>`
        select distinct m.content_item_id as item, m.id as moment
        from ${LIVE}
        where q.status = 'live' and m.content_item_id = any(${items}::bigint[])
      `.execute(db);
      const live = new Set(rows.map((r) => quizKey(r.item, r.moment)));
      const articles = new Set(rows.map((r) => r.item));
      return new Set(
        targets
          .filter((t) =>
            t.momentId === null
              ? articles.has(t.itemId)
              : live.has(quizKey(t.itemId, t.momentId)),
          )
          .map((t) => quizKey(t.itemId, t.momentId)),
      );
    },

    attempt: async (userId, attemptId) => {
      const row = await db
        .selectFrom("quiz_attempt as a")
        .innerJoin("content_item as ci", "ci.id", "a.content_item_id")
        .leftJoin("moment as m", "m.id", "a.moment_id")
        .select([
          "a.content_item_id",
          "a.moment_id",
          "a.started_at",
          "a.ends_at",
          "a.finished_at",
          sql<string>`coalesce(m.title, ci.title)`.as("title"),
          sql<number>`greatest(0, ceil(extract(epoch from a.ends_at - now())))::int`.as(
            "seconds_left",
          ),
          sql<number>`(select count(*)::int from quiz_answer qa
            where qa.attempt_id = a.id and qa.answered_at is not null)`.as(
            "answered",
          ),
          sql<number>`(select count(*)::int from quiz_answer qa
            where qa.attempt_id = a.id and qa.correct)`.as("correct"),
          sql<number | null>`(select avg(extract(epoch from
              qa.answered_at - qa.served_at) * 1000)::float8
            from quiz_answer qa
            where qa.attempt_id = a.id and qa.answered_at is not null)`.as(
            "avg_ms",
          ),
        ])
        .where("a.id", "=", attemptId)
        .where("a.user_id", "=", userId)
        .executeTakeFirst();
      if (row === undefined) return null;
      // The live concepts its answered questions test, with the user's state.
      const concepts = await db
        .selectFrom("quiz_answer as qa")
        .innerJoin("question_concept as qc", "qc.question_id", "qa.question_id")
        .innerJoin("concept as c", "c.id", "qc.concept_id")
        .leftJoin("concept_mastery as cm", (join) =>
          join
            .onRef("cm.concept_id", "=", "c.id")
            .on("cm.user_id", "=", userId),
        )
        .select(["c.name", "cm.state"])
        .distinct()
        .where("qa.attempt_id", "=", attemptId)
        .where("qa.answered_at", "is not", null)
        .where("c.retired_at", "is", null)
        .orderBy("c.name")
        .execute();
      return {
        itemId: row.content_item_id,
        momentId: row.moment_id,
        title: row.title,
        startedAt: row.started_at,
        endsAt: row.ends_at,
        secondsLeft: row.seconds_left,
        finishedAt: row.finished_at,
        answered: row.answered,
        correct: row.correct,
        avgMs: row.avg_ms === null ? null : Math.round(row.avg_ms),
        concepts: concepts.map((c) => ({ name: c.name, state: c.state })),
      };
    },

    answered: async (userId, attemptId, questionId) => {
      const row = await db
        .selectFrom("quiz_answer as qa")
        .innerJoin("quiz_attempt as a", "a.id", "qa.attempt_id")
        .innerJoin("question as q", "q.id", "qa.question_id")
        .select([
          "q.stem",
          "q.options",
          "qa.chosen",
          "q.correct as key",
          "qa.correct",
        ])
        .where("qa.attempt_id", "=", attemptId)
        .where("qa.question_id", "=", questionId)
        .where("a.user_id", "=", userId)
        .executeTakeFirst();
      if (row === undefined || row.chosen === null || row.correct === null)
        return null;
      return {
        stem: row.stem,
        options: row.options,
        chosen: row.chosen,
        correctOption: row.key,
        correct: row.correct,
      };
    },
  };
}
