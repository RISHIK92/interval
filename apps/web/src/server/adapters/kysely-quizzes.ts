import type { DB } from "@interval/db";
import { type Kysely, type RawBuilder, sql } from "kysely";
import {
  CHECKPOINT_SIZE,
  QUIZ_SECONDS,
  type CheckpointAt,
  type CheckpointInfo,
  type QuizFinish,
  type QuizQuestion,
  type Quizzes,
  quizKey,
} from "../ports";
import { fsrsState, rate } from "../reviews";
import {
  chapterQuestions,
  checkpointQuestions,
  readingsDone,
  sectionOpen,
  sectionPassed,
  skipped,
} from "./checkpoints";

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

// P2-W10-S04 (§5F, Q-P2-26), after the ratings: a passed checkpoint raises each of
// its section's (or, P2-W11-S06, its book chapter's) live concepts to at least
// practiced (a mastered one stays mastered); the concepts of its wrong answers,
// passed or not, are due for review now.
async function settleCheckpoint(
  trx: Kysely<DB>,
  userId: string,
  attemptId: string,
  now: Date,
): Promise<void> {
  const attempt = await trx
    .selectFrom("quiz_attempt as a")
    .select([
      "a.path_section_id",
      "a.book_chapter_id",
      "a.pass_mark",
      sql<number>`(select count(*)::int from quiz_answer qa
        where qa.attempt_id = a.id and qa.correct)`.as("correct"),
    ])
    .where("a.id", "=", attemptId)
    .executeTakeFirstOrThrow();
  // Not a checkpoint. (pass_mark isn't null then: greatest() skips the null size.)
  if (
    (attempt.path_section_id === null && attempt.book_chapter_id === null) ||
    attempt.pass_mark === null
  )
    return;
  const concepts =
    attempt.path_section_id !== null
      ? sql`select concept_id from path_section_concept
          where section_id = ${attempt.path_section_id}`
      : sql`select concept_id from book_chapter_concept
          where chapter_id = ${attempt.book_chapter_id}`;
  const passed = attempt.correct >= attempt.pass_mark;
  await trx
    .updateTable("quiz_attempt")
    .set({ checkpoint_passed: passed })
    .where("id", "=", attemptId)
    .execute();
  if (passed)
    // In concept order, like the answers' mastery rows (PER-2).
    await sql`
      insert into concept_mastery
        (user_id, concept_id, probability, state, evidence_count)
      select ${userId}, pc.concept_id, ${PRACTICED}::float8, 'practiced', 1
      from (${concepts}) pc
      join concept c on c.id = pc.concept_id and c.retired_at is null
      order by pc.concept_id
      on conflict (user_id, concept_id) do update set
        probability = greatest(concept_mastery.probability, ${PRACTICED}::float8),
        state = case when concept_mastery.state = 'mastered'
          then 'mastered'::learner_state else 'practiced'::learner_state end,
        evidence_count = concept_mastery.evidence_count + 1,
        updated_at = now()
    `.execute(trx);
  // The cards were just made or rated (rateConcepts), so each missed concept has one.
  await sql`
    update concept_review set due = ${now}
    where user_id = ${userId} and concept_id in (
      select qc.concept_id from quiz_answer qa
      join question_concept qc on qc.question_id = qa.question_id
      join concept c on c.id = qc.concept_id and c.retired_at is null
      where qa.attempt_id = ${attemptId} and not qa.correct
    )
  `.execute(trx);
}

// Where an attempt's checkpoint belongs; null when it isn't one.
function checkpointAt(row: {
  path_section_id: string | null;
  path_id: string | null;
  book_chapter_id: string | null;
  book_id: string | null;
}): CheckpointAt | null {
  if (row.path_section_id !== null && row.path_id !== null)
    return {
      kind: "path",
      pathId: row.path_id,
      sectionId: row.path_section_id,
    };
  if (row.book_chapter_id !== null && row.book_id !== null)
    return {
      kind: "book",
      bookId: row.book_id,
      chapterId: row.book_chapter_id,
    };
  return null;
}

type Open = {
  question_id: string;
  stem: string;
  options: string[];
  served_at: Date;
  over: boolean;
};

// The concepts due for review with a live question its rights allow (ING-2), most
// overdue first: one session's worth (Q-P2-17).
const REVIEW_SIZE = 10;
// A review left this long since its last question is over (suggested default,
// 2026-10-28): what was answered is rated, and the next review takes the due list
// as it is then.
const REVIEW_IDLE = sql.raw(`interval '30 minutes'`);
const dueConcepts = (userId: string) => sql<{
  id: string;
  name: string;
  days_since: number | null;
}>`
  select c.id, c.name,
    floor(extract(epoch from now() - r.last_review) / 86400)::int as days_since
  from concept_review r
  join concept c on c.id = r.concept_id and c.retired_at is null
  where r.user_id = ${userId} and r.due <= now()
    and exists (
      select 1 from ${LIVE}
      join question_concept qc on qc.question_id = q.id
      where q.status = 'live' and qc.concept_id = r.concept_id
    )
  order by r.due, c.id
  limit ${REVIEW_SIZE}
`;

export function kyselyQuizzes(db: Kysely<DB>): Quizzes {
  // Q-P2-16: a card is made by a quiz answer, so a quiz left behind (the tab closed
  // before the finish) is closed and rated: a sprint at its clock's end, a review at
  // its last activity once it has been idle for REVIEW_IDLE.
  // A finished attempt's counts, and for a checkpoint whether it passed.
  const summary = async (
    userId: string,
    attemptId: string,
    firstTime: boolean,
  ): Promise<QuizFinish | null> => {
    const row = await db
      .selectFrom("quiz_attempt as a")
      .leftJoin("path_section as s", "s.id", "a.path_section_id")
      .leftJoin("book_chapter as bc", "bc.id", "a.book_chapter_id")
      .leftJoin("quiz_answer as qa", (join) =>
        join
          .onRef("qa.attempt_id", "=", "a.id")
          .on("qa.answered_at", "is not", null),
      )
      .select([
        "a.path_section_id",
        "a.book_chapter_id",
        "a.checkpoint_passed",
        "s.path_id",
        "bc.book_id",
        sql<number>`count(qa.question_id)::int`.as("answered"),
        sql<number>`count(*) filter (where qa.correct)::int`.as("correct"),
      ])
      .where("a.id", "=", attemptId)
      .where("a.user_id", "=", userId)
      .groupBy(["a.id", "s.path_id", "bc.book_id"])
      .executeTakeFirst();
    if (row === undefined) return null;
    const at = checkpointAt(row);
    return {
      answered: row.answered,
      correct: row.correct,
      firstTime,
      checkpoint:
        at === null || row.checkpoint_passed === null
          ? null
          : { at, passed: row.checkpoint_passed },
    };
  };

  const closeStale = async (
    userId: string,
  ): Promise<(QuizFinish & { attemptId: string })[]> => {
    // greatest() skips nulls: a review's last activity is its newest serve or answer,
    // or its start.
    const { rows: stale } = await sql<{ id: string; ended: Date }>`
      select a.id, coalesce(a.ends_at, last.at) as ended
      from quiz_attempt a
      cross join lateral (
        select greatest(a.started_at, max(qa.served_at), max(qa.answered_at)) as at
        from quiz_answer qa where qa.attempt_id = a.id
      ) last
      where a.user_id = ${userId} and a.finished_at is null
        and case when a.review then last.at + ${REVIEW_IDLE}
                 else a.ends_at + ${GRACE} end < now()
    `.execute(db);
    const done: (QuizFinish & { attemptId: string })[] = [];
    for (const { id, ended } of stale) {
      const closed = await inTransaction(db, async (trx) => {
        const row = await trx
          .updateTable("quiz_attempt")
          .set({ finished_at: ended })
          .where("id", "=", id)
          .where("finished_at", "is", null)
          .returning("finished_at")
          .executeTakeFirst();
        if (row?.finished_at == null) return false;
        await rateConcepts(trx, userId, id, row.finished_at);
        await settleCheckpoint(trx, userId, id, row.finished_at);
        return true;
      });
      // Another request closed it first: that one reports it.
      const counts = closed ? await summary(userId, id, true) : null;
      if (counts !== null) done.push({ ...counts, attemptId: id });
    }
    return done;
  };

  // The attempt's open (served, unanswered) question, with whether the clock is out.
  const open = async (attemptId: string): Promise<Open | undefined> => {
    const { rows } = await sql<Open>`
      select qa.question_id, q.stem, q.options, qa.served_at,
             (coalesce(now() > a.ends_at + ${GRACE}, false)
               or a.finished_at is not null) as over
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

  const checkpointInfo = async (
    attemptId: string,
    at: CheckpointAt,
    taken: { size: number; passMark: number; passed: boolean },
  ): Promise<CheckpointInfo> => {
    const { rows: missed } = await sql<{ name: string }>`
      select distinct c.name from quiz_answer qa
      join question_concept qc on qc.question_id = qa.question_id
      join concept c on c.id = qc.concept_id and c.retired_at is null
      where qa.attempt_id = ${attemptId} and not qa.correct
      order by c.name
    `.execute(db);
    if (at.kind === "book") {
      const chapter = await db
        .selectFrom("book_chapter as bc")
        .select([
          "bc.title",
          sql<string[]>`array(
            select c.name from book_chapter_concept k
            join concept c on c.id = k.concept_id and c.retired_at is null
            where k.chapter_id = bc.id order by c.name)`.as("concepts"),
        ])
        .where("bc.id", "=", at.chapterId)
        .executeTakeFirstOrThrow();
      return {
        at,
        title: chapter.title,
        concepts: chapter.concepts,
        ...taken,
        next: null,
        missed: missed.map((m) => m.name),
      };
    }
    const names = (section: RawBuilder<unknown>) => sql<string[]>`array(
      select c.name from path_section_concept pc
      join concept c on c.id = pc.concept_id
      where pc.section_id = ${section} order by c.name)`;
    const row = await db
      .selectFrom("path_section as s")
      .select([
        names(sql`s.id`).as("concepts"),
        sql<string[] | null>`(
          select ${names(sql`n.id`)} from path_section n
          where n.path_id = s.path_id and n.ordinal > s.ordinal
          order by n.ordinal limit 1)`.as("next"),
      ])
      .where("s.id", "=", at.sectionId)
      .executeTakeFirstOrThrow();
    return {
      at,
      title: row.concepts.join(", "),
      concepts: row.concepts,
      ...taken,
      next: row.next,
      missed: missed.map((m) => m.name),
    };
  };

  return {
    closeStale,

    start: async (userId, itemId, momentId) => {
      const running = await db
        .selectFrom("quiz_attempt")
        // A sprint (content_item_id set) always has an end.
        .select(["id", sql<Date>`ends_at`.as("ends_at")])
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
        .select([
          "review",
          "path_section_id",
          "book_chapter_id",
          "checkpoint_size",
          sql<boolean>`coalesce(now() > ends_at, false)
            or finished_at is not null`.as("ended"),
        ])
        .where("id", "=", attemptId)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (attempt === undefined) return null;
      const current = await open(attemptId);
      if (current !== undefined)
        return current.over ? "over" : asQuestion(current);
      if (attempt.ended) return "over";
      const section = attempt.path_section_id;
      const chapter = attempt.book_chapter_id;
      if (section !== null || chapter !== null) {
        // P2-W10-S04: up to its size; the section's own readings' questions first,
        // then its concepts' at random (a book chapter: its own, P2-W11-S06).
        // Questions the user's last checkpoint on it asked come after all the rest
        // (own or not), so a retry isn't the same quiz.
        const same =
          section !== null
            ? sql`path_section_id = ${section}`
            : sql`book_chapter_id = ${chapter}`;
        const candidates =
          section !== null
            ? checkpointQuestions(userId, sql`${section}`)
            : chapterQuestions(sql`${chapter}`);
        await sql`
          with last as (
            select qa.question_id from quiz_answer qa
            where qa.attempt_id = (
              select id from quiz_attempt
              where user_id = ${userId} and ${same}
                and id <> ${attemptId} and finished_at is not null
              order by started_at desc
              limit 1
            )
          ),
          pick as (
            select id from (${candidates}) cq
            where id not in (
              select question_id from quiz_answer where attempt_id = ${attemptId}
            )
            order by id in (select question_id from last), tier, ro, qo, random()
            limit 1
          )
          insert into quiz_answer (attempt_id, question_id)
          select ${attemptId}, id from pick
          where (select count(*) from quiz_answer where attempt_id = ${attemptId})
            < ${attempt.checkpoint_size}
          on conflict do nothing
        `.execute(db);
        const served = await open(attemptId);
        return served === undefined || served.over
          ? "over"
          : asQuestion(served);
      }
      if (attempt.review) {
        // Q-P2-17: the session's first concept no served question tests yet, with a
        // live question on it at random; a concept with none left is passed over.
        await sql`
          with covered as (
            select qc.concept_id from quiz_answer qa
            join question_concept qc on qc.question_id = qa.question_id
            where qa.attempt_id = ${attemptId}
          ),
          pick as (
            select q.id
            from ${LIVE}
            join question_concept qc on qc.question_id = q.id
            join quiz_attempt_concept ac on ac.concept_id = qc.concept_id
            join concept c on c.id = ac.concept_id and c.retired_at is null
            where ac.attempt_id = ${attemptId}
              and q.status = 'live'
              and ac.concept_id not in (select concept_id from covered)
            order by ac.ordinal, random()
            limit 1
          )
          insert into quiz_answer (attempt_id, question_id)
          select ${attemptId}, id from pick
          on conflict do nothing
        `.execute(db);
        const served = await open(attemptId);
        return served === undefined || served.over
          ? "over"
          : asQuestion(served);
      }
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
            and coalesce(now() <= a.ends_at + ${GRACE}, true)
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
        if (done?.finished_at != null) {
          await rateConcepts(trx, userId, attemptId, done.finished_at);
          await settleCheckpoint(trx, userId, attemptId, done.finished_at);
        }
        return done;
      });
      return summary(userId, attemptId, finished !== undefined);
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
        .leftJoin("content_item as ci", "ci.id", "a.content_item_id")
        .leftJoin("moment as m", "m.id", "a.moment_id")
        .select([
          "a.review",
          "a.content_item_id",
          "a.moment_id",
          "a.started_at",
          "a.ends_at",
          "a.finished_at",
          "a.path_section_id",
          "a.book_chapter_id",
          sql<string | null>`(select s.path_id from path_section s
            where s.id = a.path_section_id)`.as("path_id"),
          sql<string | null>`(select bc.book_id from book_chapter bc
            where bc.id = a.book_chapter_id)`.as("book_id"),
          "a.checkpoint_size",
          "a.pass_mark",
          "a.checkpoint_passed",
          sql<string>`coalesce(m.title, ci.title, 'Review')`.as("title"),
          sql<number | null>`case when a.ends_at is not null
            then greatest(0, ceil(extract(epoch from a.ends_at - now())))::int end`.as(
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
      const at = checkpointAt(row);
      const checkpoint =
        at === null || row.checkpoint_size === null || row.pass_mark === null
          ? null
          : await checkpointInfo(attemptId, at, {
              size: row.checkpoint_size,
              passMark: row.pass_mark,
              passed: row.checkpoint_passed === true,
            });
      return {
        review: row.review,
        itemId: row.content_item_id,
        momentId: row.moment_id,
        title: checkpoint === null ? row.title : checkpoint.title,
        startedAt: row.started_at,
        endsAt: row.ends_at,
        secondsLeft: row.seconds_left,
        finishedAt: row.finished_at,
        answered: row.answered,
        correct: row.correct,
        avgMs: row.avg_ms === null ? null : Math.round(row.avg_ms),
        concepts: concepts.map((c) => ({ name: c.name, state: c.state })),
        checkpoint,
      };
    },

    startCheckpoint: async (userId, sectionId) => {
      const section = await db
        .selectFrom("path_section")
        .select("path_id")
        .where("id", "=", sectionId)
        .executeTakeFirst();
      if (section === undefined) return null;
      const running = () =>
        db
          .selectFrom("quiz_attempt")
          .select("id")
          .where("user_id", "=", userId)
          .where("path_section_id", "=", sectionId)
          .where("finished_at", "is", null)
          .executeTakeFirst();
      const was = await running();
      if (was !== undefined)
        return { attemptId: was.id, pathId: section.path_id, firstTime: false };
      // A double tap racing this one inserts nothing (one running checkpoint per user
      // and section, an index): it then meets the one that won.
      const { rows } = await sql<{ id: string }>`
        insert into quiz_attempt
          (user_id, path_section_id, checkpoint_size, ends_at)
        select ${userId}, s.id,
               least(${CHECKPOINT_SIZE},
                 (select count(*) from (${checkpointQuestions(userId, sql`s.id`)}) cq)),
               now() + ${DURATION}
        from path_section s
        join path p on p.id = s.path_id and p.status = 'live'
        join user_path up on up.path_id = p.id
          and up.user_id = ${userId} and up.status = 'active'
        where s.id = ${sectionId}
          and ${sectionOpen(userId, sql`s.id`)}
          and ${readingsDone(userId, sql`s.id`)}
          and not ${sectionPassed(userId, sql`s.id`)}
          and not ${skipped(userId, sql`s.id`)}
          and exists (${checkpointQuestions(userId, sql`s.id`)})
        on conflict (user_id, path_section_id)
          where path_section_id is not null and finished_at is null
        do nothing
        returning id
      `.execute(db);
      const made = rows[0];
      if (made !== undefined)
        return { attemptId: made.id, pathId: section.path_id, firstTime: true };
      const won = await running();
      return won === undefined
        ? null
        : { attemptId: won.id, pathId: section.path_id, firstTime: false };
    },

    // P2-W11-S06 (Q-P2-35): the same insert-or-meet-the-winner as a section's, for a
    // ready chapter checkpoint of the user's own ready book. Its chapters don't lock
    // (owner, 2026-10-29), and a passed one can be taken again.
    startBookCheckpoint: async (userId, chapterId) => {
      const chapter = await db
        .selectFrom("book_chapter as bc")
        .innerJoin("book as b", "b.id", "bc.book_id")
        .select("bc.book_id")
        .where("bc.id", "=", chapterId)
        .where("b.user_id", "=", userId)
        .where("b.status", "=", "ready")
        .executeTakeFirst();
      if (chapter === undefined) return null;
      const running = () =>
        db
          .selectFrom("quiz_attempt")
          .select("id")
          .where("user_id", "=", userId)
          .where("book_chapter_id", "=", chapterId)
          .where("finished_at", "is", null)
          .executeTakeFirst();
      const was = await running();
      if (was !== undefined)
        return { attemptId: was.id, bookId: chapter.book_id, firstTime: false };
      const { rows } = await sql<{ id: string }>`
        insert into quiz_attempt
          (user_id, book_chapter_id, checkpoint_size, ends_at)
        select ${userId}, k.chapter_id,
               least(${CHECKPOINT_SIZE},
                 (select count(*) from (${chapterQuestions(sql`k.chapter_id`)}) cq)),
               now() + ${DURATION}
        from book_chapter_checkpoint k
        where k.chapter_id = ${chapterId} and k.status = 'ready'
          and exists (${chapterQuestions(sql`k.chapter_id`)})
        on conflict (user_id, book_chapter_id)
          where book_chapter_id is not null and finished_at is null
        do nothing
        returning id
      `.execute(db);
      const made = rows[0];
      if (made !== undefined)
        return { attemptId: made.id, bookId: chapter.book_id, firstTime: true };
      const won = await running();
      return won === undefined
        ? null
        : { attemptId: won.id, bookId: chapter.book_id, firstTime: false };
    },

    dueReviews: async (userId) => {
      const { rows } = await dueConcepts(userId).execute(db);
      return rows.map((r) => ({
        conceptId: r.id,
        name: r.name,
        daysSince: r.days_since,
      }));
    },

    startReview: async (userId) => {
      return inTransaction(db, async (trx) => {
        // One running review per user: a double tap, or coming back, continues it.
        const running = await trx
          .selectFrom("quiz_attempt as a")
          .select([
            "a.id",
            sql<number>`(select count(*)::int from quiz_attempt_concept ac
              where ac.attempt_id = a.id)`.as("concepts"),
          ])
          .where("a.user_id", "=", userId)
          .where("a.review", "=", true)
          .where("a.finished_at", "is", null)
          .orderBy("a.started_at", "desc")
          .executeTakeFirst();
        if (running !== undefined)
          return {
            attemptId: running.id,
            concepts: running.concepts,
            firstTime: false,
          };
        const { rows: due } = await dueConcepts(userId).execute(trx);
        if (due.length === 0) return null;
        // A double tap racing this one inserts nothing (one open review per user,
        // an index): it then meets the one that won.
        const { rows: made } = await sql<{ id: string }>`
          insert into quiz_attempt (user_id, review) values (${userId}, true)
          on conflict (user_id) where review and finished_at is null do nothing
          returning id
        `.execute(trx);
        const attempt = made[0];
        if (attempt === undefined) {
          const won = await trx
            .selectFrom("quiz_attempt")
            .select("id")
            .where("user_id", "=", userId)
            .where("review", "=", true)
            .where("finished_at", "is", null)
            .executeTakeFirstOrThrow();
          return { attemptId: won.id, concepts: due.length, firstTime: false };
        }
        await trx
          .insertInto("quiz_attempt_concept")
          .values(
            due.map((c, ordinal) => ({
              attempt_id: attempt.id,
              concept_id: c.id,
              ordinal,
            })),
          )
          .execute();
        return { attemptId: attempt.id, concepts: due.length, firstTime: true };
      });
    },

    // One statement: the flag, the question leaving quizzes (a live one becomes
    // flagged) and its spot check (Q-2: everything flagged), only for a question the
    // user answered in their own attempt, once per user.
    flag: async (userId, attemptId, questionId, reason) => {
      const { rows } = await sql<{ question_id: string }>`
        with answered as (
          select 1 from quiz_answer qa
          join quiz_attempt a on a.id = qa.attempt_id and a.user_id = ${userId}
          where qa.attempt_id = ${attemptId} and qa.question_id = ${questionId}
            and qa.answered_at is not null
        ),
        flagged as (
          insert into question_flag (user_id, question_id, reason)
          select ${userId}, ${questionId}, ${reason}::flag_reason
          where exists (select 1 from answered)
          on conflict (user_id, question_id) do nothing
          returning question_id
        ),
        -- A book chapter's question (P2-W11-S06) is its owner's alone: the flag is
        -- kept as their feedback, but no one else may review it, and it stays in
        -- their checkpoint.
        marked as (
          update question set status = 'flagged'
          where id = ${questionId} and status = 'live' and moment_id is not null
            and exists (select 1 from flagged)
        ),
        -- A question in this week's sample is now there because it was flagged;
        -- one retired meanwhile has nothing left to check.
        queued as (
          insert into question_review (question_id, reason)
          select ${questionId}, 'flagged'
          where exists (select 1 from flagged)
            and exists (
              select 1 from question
              where id = ${questionId} and status in ('live', 'flagged')
                and moment_id is not null
            )
          on conflict (question_id) where decision is null
          do update set reason = 'flagged'
        )
        select question_id from flagged
      `.execute(db);
      return rows.length > 0;
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
          sql<boolean>`exists (
            select 1 from question_flag f
            where f.user_id = ${userId} and f.question_id = q.id
          )`.as("flagged"),
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
        flagged: row.flagged,
      };
    },
  };
}
