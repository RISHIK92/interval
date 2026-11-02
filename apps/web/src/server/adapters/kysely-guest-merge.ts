import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";

// P3-W13-S07 (ADR-0029, Q-P1-11; owner, 2026-10-31 and 2026-11-02): a guest who signs
// in to an existing account brings their Play data, inside the caller's transaction.
// - Games move with their answers (PER-2 evidence); a daily day both played keeps the
//   better score (a tie, the account's), so the streak is the union of days.
// - Mastery keeps the higher probability; a review card the one with more reviews.
// - The guest row goes, and with it everything only a guest has (sessions,
//   capabilities). Guests are Play-only (ADR-0029), so no reading data is lost.
// Board scores (P3-W14-S01) follow their attempts; ratings (W16) add their rule here.
// False when there's no such guest: a retry or a second sign-in is a no-op (LOAD-5).
export async function mergeGuest(
  trx: Kysely<DB>,
  guestId: string,
  accountId: string,
): Promise<boolean> {
  const guest = await trx
    .selectFrom("app_user")
    .select("id")
    .where("id", "=", guestId)
    .where("is_anonymous", "=", true)
    .forUpdate()
    .executeTakeFirst();
  if (guest === undefined || guestId === accountId) return false;

  // A guest request still running could update these rows after they're copied and
  // before the guest goes; it waits instead. New rows already wait on the user lock.
  await sql`select 1 from concept_mastery where user_id = ${guestId} for update`.execute(
    trx,
  );
  await sql`select 1 from concept_review where user_id = ${guestId} for update`.execute(
    trx,
  );

  // An open game would meet the account's own under the one-open rules.
  await trx
    .updateTable("quiz_attempt")
    .set({ finished_at: sql<Date>`now()` })
    .where("user_id", "=", guestId)
    .where("finished_at", "is", null)
    .execute();

  // dailyPoints (kysely-quizzes.ts) in SQL: 100 a right choice, an estimate's points.
  // numeric rounds half up as Math.round does; float8's round would go to even.
  await sql`
    with points as (
      select a.id, a.user_id, a.daily_day,
             (select coalesce(sum(case when qa.correct then 100
                    else round((coalesce(qa.score, 0) * 100)::numeric) end), 0)
              from quiz_answer qa where qa.attempt_id = a.id) as points
      from quiz_attempt a
      where a.user_id in (${guestId}, ${accountId}) and a.daily_day is not null
    )
    delete from quiz_attempt where id in (
      select loser.id from points loser
      join points winner on winner.daily_day = loser.daily_day
        and winner.user_id <> loser.user_id
      where loser.points < winner.points
         or (loser.points = winner.points and loser.user_id = ${guestId})
    )`.execute(trx);

  await trx
    .updateTable("quiz_attempt")
    .set({ user_id: accountId })
    .where("user_id", "=", guestId)
    .execute();

  await sql`
    insert into concept_mastery as m
      (user_id, concept_id, probability, state, evidence_count, updated_at)
    select ${accountId}, concept_id, probability, state, evidence_count, updated_at
    from concept_mastery where user_id = ${guestId}
    on conflict (user_id, concept_id) do update set
      probability = excluded.probability, state = excluded.state,
      evidence_count = excluded.evidence_count, updated_at = excluded.updated_at
    where excluded.probability > m.probability`.execute(trx);

  await sql`
    insert into concept_review as r
      (user_id, concept_id, due, stability, difficulty, scheduled_days,
       learning_steps, reps, lapses, state, last_review)
    select ${accountId}, concept_id, due, stability, difficulty, scheduled_days,
           learning_steps, reps, lapses, state, last_review
    from concept_review where user_id = ${guestId}
    on conflict (user_id, concept_id) do update set
      due = excluded.due, stability = excluded.stability,
      difficulty = excluded.difficulty, scheduled_days = excluded.scheduled_days,
      learning_steps = excluded.learning_steps, reps = excluded.reps,
      lapses = excluded.lapses, state = excluded.state,
      last_review = excluded.last_review
    where excluded.reps > r.reps`.execute(trx);

  await sql`
    insert into question_flag (user_id, question_id, reason, flagged_at)
    select ${accountId}, question_id, reason, flagged_at
    from question_flag where user_id = ${guestId}
    on conflict do nothing`.execute(trx);

  await trx.deleteFrom("app_user").where("id", "=", guestId).execute();
  return true;
}
