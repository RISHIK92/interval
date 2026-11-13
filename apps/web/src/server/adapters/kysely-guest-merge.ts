import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";

// P3-W13-S07 (ADR-0029, Q-P1-11; owner, 2026-10-31 and 2026-11-02): a guest who signs
// in to an existing account brings their Play data, inside the caller's transaction.
// - Games move with their answers (PER-2 evidence); a daily day both played keeps the
//   better score (a tie, the account's), so the streak is the union of days.
// - Mastery keeps the higher probability; a review card the one with more reviews.
// - The guest row goes, and with it everything only a guest has (sessions,
//   capabilities). Guests are Play-only (ADR-0029), so no reading data is lost.
// Board scores (P3-W14-S01) follow their attempts; the more-played rating stays, with
// its own history (P3-W16-S01).
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

  // P3-W15-S02: its live matches; one both were in already has the account.
  // Q-P3-21: it plays on as the guest the game server knows (played_as).
  // P3-W15-S05: with what was recorded, and its wins stay won.
  await sql`
    insert into game_match_player
      (match_id, user_id, played_as, total, time_ms, abandoned, signals)
    select match_id, ${accountId}, coalesce(played_as, user_id), total, time_ms,
           abandoned, signals
    from game_match_player where user_id = ${guestId}
    on conflict do nothing`.execute(trx);
  await trx
    .updateTable("game_match")
    .set({ winner_id: accountId })
    .where("winner_id", "=", guestId)
    .execute();
  // P3-W17-S01: its recorded runs are the account's games now, kept as ghosts; in a
  // match both played (a self-match), the account's own run stays.
  await sql`
    delete from ghost_run g where g.user_id = ${guestId}
      and exists (select 1 from ghost_run o
        where o.match_id = g.match_id and o.user_id = ${accountId})`.execute(
    trx,
  );
  await trx
    .updateTable("ghost_run")
    .set({ user_id: accountId })
    .where("user_id", "=", guestId)
    .execute();

  // P3-W16-S01 (ADR-0034; owner, 2026-11-02): the more-played rating stays with the
  // account, with its own history only, so the account's history chains to its rating.
  // Locked first: a worker rating the guest's match waits for the merge, or the merge
  // for it.
  const ratings = await sql<{ user_id: string; games: number }>`
    select user_id, games from player_rating
    where user_id in (${guestId}, ${accountId})
    order by user_id
    for update`.execute(trx);
  const games = (id: string) =>
    ratings.rows.find((r) => r.user_id === id)?.games;
  const guestGames = games(guestId);
  const accountGames = games(accountId);
  const keepsGuestRating =
    guestGames !== undefined &&
    (accountGames === undefined || guestGames > accountGames);
  if (keepsGuestRating) {
    await trx
      .deleteFrom("rating_history")
      .where("user_id", "=", accountId)
      .execute();
    await trx
      .updateTable("rating_history")
      .set({ user_id: accountId })
      .where("user_id", "=", guestId)
      .execute();
    // P3-W16-S06: and the closed seasons' final boards, as for the history.
    await trx
      .deleteFrom("season_standing")
      .where("user_id", "=", accountId)
      .execute();
    await trx
      .updateTable("season_standing")
      .set({ user_id: accountId })
      .where("user_id", "=", guestId)
      .execute();
    await sql`
      insert into player_rating
        (user_id, rating, rd, volatility, games, updated_at)
      select ${accountId}, rating, rd, volatility, games, updated_at
      from player_rating where user_id = ${guestId}
      on conflict (user_id) do update set
        rating = excluded.rating, rd = excluded.rd,
        volatility = excluded.volatility, games = excluded.games,
        updated_at = excluded.updated_at`.execute(trx);
  }
  // Otherwise the guest's rating, history and season standings go with the guest.

  // P5-W35 (Q-P5-22): its battles' best submissions, reviews and disputes; in a battle
  // the account played too (a self-match), the account's own stay and the guest's go.
  for (const table of [
    "battle_best_submission",
    "battle_review",
    "battle_dispute",
  ] as const)
    await sql`
      update ${sql.table(table)} g set user_id = ${accountId}
      where g.user_id = ${guestId}
        and not exists (select 1 from ${sql.table(table)} o
          where o.user_id = ${accountId} and o.match_id = g.match_id)`.execute(
      trx,
    );

  // P5-W32-S01a, S01b (Q-P5-18): 1v1 battle ratings and room ratings, by the same
  // rule in each league.
  await mergeLeagueRatings(trx, guestId, accountId, "battle_rating");
  await mergeLeagueRatings(trx, guestId, accountId, "room_rating");

  // P3-W18-S02 (§6.9): its fair-play flags. Not those of a match the account played
  // too: a penalty there would drop the account's own run. A penalty only with the
  // rating it was taken from: the account's own was never lowered by it.
  await sql`
    insert into fair_play_flag
      (match_id, user_id, signals, created_at, decision, decided_at, decided_by,
       penalty)
    select f.match_id, ${accountId}, f.signals, f.created_at, f.decision,
           f.decided_at, f.decided_by, f.penalty
    from fair_play_flag f
    where f.user_id = ${guestId}
      and (f.decision is distinct from 'penalized' or ${keepsGuestRating})
      and not exists (select 1 from game_match_player o
        where o.match_id = f.match_id and o.user_id = ${accountId}
          and o.played_as is distinct from ${guestId})
    on conflict do nothing`.execute(trx);

  // P5-W31-S04b: its battle code snapshots, for the flags above (guests battle: they
  // have the beta plan). Their objects keep the guest's id in the key.
  // Moved, not copied (the key is unique); one in the same 25 s slot as the account's own
  // in a self-match stays with the guest, its object left for S04b-2's pruning to miss
  // (shortcut: a near-impossible case; delete the object here if it's ever seen).
  await sql`
    update battle_snapshot g set user_id = ${accountId}
    where g.user_id = ${guestId}
      and not exists (select 1 from battle_snapshot o
        where o.user_id = ${accountId} and o.match_id = g.match_id
          and o.slot = g.slot)`.execute(trx);

  await trx.deleteFrom("app_user").where("id", "=", guestId).execute();
  return true;
}

// Per league, the more-played rating stays with the account, with its own history
// (`<table>_history`), as quick games' does. Locked in user_id order, as rating a match
// locks.
async function mergeLeagueRatings(
  trx: Kysely<DB>,
  guestId: string,
  accountId: string,
  table: "battle_rating" | "room_rating",
): Promise<void> {
  const ratings = await sql<{ user_id: string; league: string; games: number }>`
    select user_id, league, games from ${sql.table(table)}
    where user_id in (${guestId}, ${accountId})
    order by user_id, league
    for update`.execute(trx);
  const games = (id: string, league: string) =>
    ratings.rows.find((r) => r.user_id === id && r.league === league)?.games;
  // The rating's own columns, copied as they are.
  const columns =
    table === "battle_rating"
      ? ["rating", "rd", "volatility"]
      : ["mu", "sigma"];
  const kept = sql.join(
    [...columns, "games", "updated_at"].map((c) => sql.ref(c)),
  );
  const updates = sql.join(
    [...columns, "games", "updated_at"].map(
      (c) => sql`${sql.ref(c)} = excluded.${sql.ref(c)}`,
    ),
  );
  const history = sql.table(`${table}_history`);
  for (const { league } of ratings.rows.filter((r) => r.user_id === guestId)) {
    const guestPlayed = games(guestId, league) ?? 0;
    const accountPlayed = games(accountId, league);
    if (accountPlayed !== undefined && guestPlayed <= accountPlayed) continue;
    await sql`delete from ${history}
      where user_id = ${accountId} and league = ${league}`.execute(trx);
    await sql`update ${history} set user_id = ${accountId}
      where user_id = ${guestId} and league = ${league}`.execute(trx);
    // P5-W33: and that rating's season standings, as quick games' go with theirs.
    const kind = table === "battle_rating" ? "duel" : "room";
    await sql`delete from battle_season_standing
      where user_id = ${accountId} and league = ${league} and kind = ${kind}`.execute(
      trx,
    );
    await sql`update battle_season_standing set user_id = ${accountId}
      where user_id = ${guestId} and league = ${league} and kind = ${kind}`.execute(
      trx,
    );
    await sql`
      insert into ${sql.table(table)} (user_id, league, ${kept})
      select ${accountId}, league, ${kept}
      from ${sql.table(table)} where user_id = ${guestId} and league = ${league}
      on conflict (user_id, league) do update set ${updates}`.execute(trx);
  }
}
