import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { mergeGuest } from "./kysely-guest-merge";
import { kyselyQuizzes } from "./kysely-quizzes";

// P3-W13-S07 (ADR-0029; owner, 2026-10-31 and 2026-11-02): a guest who signs in to an
// existing account brings their Play data. Games and answers move; a day both played
// keeps the better score; mastery and review cards keep the further one; the guest
// row goes.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

type Seeded = {
  guest: string;
  account: string;
  concepts: string[];
  questions: string[];
};

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `MERGE${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 10,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [guest, account] = ["guest", "account"].map(
        (kind) => `${kind}-${randomUUID()}`,
      );
      if (guest === undefined || account === undefined) throw new Error("ids");
      await trx
        .insertInto("app_user")
        .values(
          [guest, account].map((id) => ({
            id,
            name: id === guest ? "" : "Ada",
            email: `${id}@merge.example.test`,
            is_anonymous: id === guest,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      const concepts = await trx
        .insertInto("concept")
        .values(
          ["a", "b", "c"].map((slug) => ({
            slug: `merge-${slug}-${randomUUID()}`,
            name: slug,
            topic: "distributed-systems",
          })),
        )
        .returning("id")
        .execute();
      const source = await trx
        .insertInto("source")
        .values({
          name: `merge-${randomUUID()}`,
          feed_url: `https://merge.example.test/${randomUUID()}.xml`,
          rights_profile: "full_text_internal",
          moments_seeded: true,
          moments_enabled: true,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const item = await trx
        .insertInto("content_item")
        .values({
          source_id: source.id,
          guid: randomUUID(),
          canonical_url: `https://merge.example.test/${randomUUID()}`,
          title: "Merge",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moment = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 0,
          title: "Merge",
          estimated_minutes: 3,
          link: "https://merge.example.test/post#merge",
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const questions = await trx
        .insertInto("question")
        .values(
          [0, 1, 2].map((ordinal) => ({
            moment_id: moment.id,
            ordinal,
            stem: `q${String(ordinal)}`,
            options: ["right", "w1", "w2", "w3"],
            correct: 0,
            citation: "a b c",
            status: "live" as const,
            generator_model: "m",
            prompt_version: 1,
            content_hash: "h",
          })),
        )
        .returning("id")
        .execute();
      await body(trx, {
        guest,
        account,
        concepts: concepts.map((c) => c.id),
        questions: questions.map((q) => q.id),
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

// A finished daily attempt `back` days ago with `right` right answers out of the
// questions given.
async function dailyPlayed(
  trx: Transaction<DB>,
  userId: string,
  back: number,
  questions: string[],
  right: number,
): Promise<string> {
  const day = sql<string>`(now() at time zone 'utc')::date - ${back}::int`;
  await sql`insert into daily_challenge (day) values (${day})
    on conflict do nothing`.execute(trx);
  const { rows } = await sql<{ id: string }>`insert into quiz_attempt
      (user_id, daily_day, started_at, ends_at, finished_at)
    values (${userId}, ${day}, now() - interval '3 hours',
            now() - interval '2 hours', now() - interval '2 hours')
    returning id`.execute(trx);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no attempt");
  for (const [index, question] of questions.entries())
    await sql`insert into quiz_answer
        (attempt_id, question_id, served_at, answered_at, chosen, correct)
      values (${id}, ${question}, now() - interval '150 minutes',
              now() - interval '149 minutes', 0, ${index < right})`.execute(
      trx,
    );
  return id;
}

const owner = async (trx: Transaction<DB>, attemptId: string) =>
  (
    await trx
      .selectFrom("quiz_attempt")
      .select("user_id")
      .where("id", "=", attemptId)
      .executeTakeFirst()
  )?.user_id;

test("the guest's games and answers move to the account, and the guest is gone", async () => {
  await inRollback(async (trx, { guest, account, questions }) => {
    const played = await dailyPlayed(trx, guest, 3, questions, 2);
    // An open sprint on each side: one open sprint each is allowed only apart.
    const open = await Promise.all(
      [guest, account].map(async (userId) => {
        const { rows } = await sql<{ id: string }>`insert into quiz_attempt
            (user_id, sprint, ends_at) values (${userId}, true,
            now() + interval '1 minute') returning id`.execute(trx);
        return rows[0]?.id ?? "";
      }),
    );
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    expect(await owner(trx, played)).toBe(account);
    const answers = await trx
      .selectFrom("quiz_answer")
      .select("question_id")
      .where("attempt_id", "=", played)
      .execute();
    expect(answers).toHaveLength(3);
    // The guest's open game is closed; the account's runs on.
    const [guestOpen, accountOpen] = await Promise.all(
      open.map((id) =>
        trx
          .selectFrom("quiz_attempt")
          .select(["user_id", "finished_at"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow(),
      ),
    );
    expect(guestOpen?.user_id).toBe(account);
    expect(guestOpen?.finished_at).not.toBeNull();
    expect(accountOpen?.finished_at).toBeNull();
    expect(
      await trx
        .selectFrom("app_user")
        .select("id")
        .where("id", "=", guest)
        .executeTakeFirst(),
    ).toBeUndefined();
  });
});

test("a day both played keeps the better score, a tie the account's; the streak counts both", async () => {
  await inRollback(async (trx, { guest, account, questions }) => {
    // 3 days ago: the guest scored better. 2 days ago: a tie. Yesterday: only the
    // account played; 4 days ago only the guest.
    const guestBetter = await dailyPlayed(trx, guest, 3, questions, 3);
    const accountWorse = await dailyPlayed(trx, account, 3, questions, 1);
    const guestTie = await dailyPlayed(trx, guest, 2, questions, 2);
    const accountTie = await dailyPlayed(trx, account, 2, questions, 2);
    await dailyPlayed(trx, account, 1, questions, 1);
    await dailyPlayed(trx, guest, 4, questions, 1);
    const quizzes = kyselyQuizzes(trx);
    expect((await quizzes.dailyStatus(account)).streak.days).toBe(3);
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    expect(await owner(trx, guestBetter)).toBe(account);
    expect(await owner(trx, accountWorse)).toBeUndefined();
    expect(await owner(trx, accountTie)).toBe(account);
    expect(await owner(trx, guestTie)).toBeUndefined();
    expect((await quizzes.dailyStatus(account)).streak.days).toBe(4);
  });
});

test("mastery and review cards keep the further one; flags are joined", async () => {
  await inRollback(async (trx, { guest, account, concepts, questions }) => {
    const [a, b, c] = concepts;
    if (a === undefined || b === undefined || c === undefined)
      throw new Error("concepts");
    const mastery = (
      userId: string,
      conceptId: string,
      probability: number,
    ) => ({
      user_id: userId,
      concept_id: conceptId,
      probability,
      state: "explored" as const,
      evidence_count: 1,
    });
    await trx
      .insertInto("concept_mastery")
      .values([
        mastery(guest, a, 0.8),
        mastery(account, a, 0.4),
        mastery(guest, b, 0.2),
        mastery(account, b, 0.6),
        mastery(guest, c, 0.5),
      ])
      .execute();
    const card = (userId: string, conceptId: string, reps: number) => ({
      user_id: userId,
      concept_id: conceptId,
      due: new Date(),
      stability: reps,
      difficulty: 5,
      scheduled_days: 1,
      learning_steps: 0,
      reps,
      lapses: 0,
      state: 2,
      last_review: new Date(),
    });
    await trx
      .insertInto("concept_review")
      .values([
        card(guest, a, 5),
        card(account, a, 2),
        card(guest, b, 3),
        { ...card(account, b, 3), stability: 9 },
        card(guest, c, 1),
      ])
      .execute();
    const [q0, q1] = questions;
    if (q0 === undefined || q1 === undefined) throw new Error("questions");
    await trx
      .insertInto("question_flag")
      .values([
        { user_id: guest, question_id: q0, reason: "unclear" },
        { user_id: guest, question_id: q1, reason: "wrong_key" },
        { user_id: account, question_id: q1, reason: "other" },
      ])
      .execute();
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    const kept = await trx
      .selectFrom("concept_mastery")
      .select(["concept_id", "probability"])
      .where("user_id", "=", account)
      .orderBy("concept_id")
      .execute();
    expect(kept).toEqual([
      { concept_id: a, probability: 0.8 },
      { concept_id: b, probability: 0.6 },
      { concept_id: c, probability: 0.5 },
    ]);
    const cards = await trx
      .selectFrom("concept_review")
      .select(["concept_id", "reps", "stability"])
      .where("user_id", "=", account)
      .orderBy("concept_id")
      .execute();
    // A tie keeps the account's card (its stability, 9, marks it).
    expect(cards).toEqual([
      { concept_id: a, reps: 5, stability: 5 },
      { concept_id: b, reps: 3, stability: 9 },
      { concept_id: c, reps: 1, stability: 1 },
    ]);
    const flags = await trx
      .selectFrom("question_flag")
      .select(["question_id", "reason"])
      .where("user_id", "=", account)
      .orderBy("question_id")
      .execute();
    expect(flags).toEqual([
      { question_id: q0, reason: "unclear" },
      { question_id: q1, reason: "other" },
    ]);
  });
});

// P3-W15-S02: a guest's live matches move with it; one both were in keeps one player.
test("the guest's matches move to the account", async () => {
  await inRollback(async (trx, { guest, account }) => {
    const match = async (players: string[]) => {
      const { id } = await trx
        .insertInto("game_match")
        .values({ server_id: 0 })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("game_match_player")
        .values(players.map((user_id) => ({ match_id: id, user_id })))
        .execute();
      return id;
    };
    const alone = await match([guest]);
    const both = await match([guest, account]);
    // P3-W17-S01: the guest's run of it, and of the one both played (the account's
    // own run of that stays).
    const ghostRun = (match_id: string, user_id: string) =>
      trx
        .insertInto("ghost_run")
        .values({
          match_id,
          user_id,
          mode: "sprint",
          rating: 1500,
          rd: 350,
          volatility: 0.06,
          answers: "[]",
        })
        .execute();
    await ghostRun(alone, guest);
    await ghostRun(both, guest);
    await ghostRun(both, account);
    // P3-W15-S05: one already recorded, the guest's win and totals.
    await sql`update game_match set finished_at = now(), outcome = 'finished',
      winner_id = ${guest} where id = ${alone}`.execute(trx);
    await sql`update game_match_player set total = 420, time_ms = 9000,
      abandoned = false where match_id = ${alone}`.execute(trx);
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    const players = await trx
      .selectFrom("game_match_player")
      .select(["match_id", "user_id", "played_as"])
      .where("match_id", "in", [alone, both])
      .orderBy("match_id")
      .execute();
    expect(players).toEqual(
      expect.arrayContaining([
        // Q-P3-21: on as the guest the game server knows.
        { match_id: alone, user_id: account, played_as: guest },
        // Both were in it: the account's own seat stays.
        { match_id: both, user_id: account, played_as: null },
      ]),
    );
    expect(players).toHaveLength(2);
    expect(
      await trx
        .selectFrom("game_match_player")
        .select(["total", "time_ms", "abandoned"])
        .where("match_id", "=", alone)
        .executeTakeFirstOrThrow(),
    ).toEqual({ total: 420, time_ms: "9000", abandoned: false });
    expect(
      (
        await trx
          .selectFrom("game_match")
          .select("winner_id")
          .where("id", "=", alone)
          .executeTakeFirstOrThrow()
      ).winner_id,
    ).toBe(account);
    expect(
      await trx
        .selectFrom("ghost_run")
        .select(["match_id", "user_id"])
        .where("match_id", "in", [alone, both])
        .orderBy("match_id")
        .execute(),
    ).toEqual(
      expect.arrayContaining([
        { match_id: alone, user_id: account },
        { match_id: both, user_id: account },
      ]),
    );
    expect(
      await trx
        .selectFrom("ghost_run")
        .select("id")
        .where("match_id", "in", [alone, both])
        .execute(),
    ).toHaveLength(2);
  });
});

// P3-W18-S02 (§6.9): the guest's fair-play signals and flags are the account's; a
// flag the account has for the same match (a self-match) stays as it is.
test("the guest's fair-play signals and flags move to the account", async () => {
  await inRollback(async (trx, { guest, account }) => {
    const match = async (players: string[]) => {
      const { id } = await trx
        .insertInto("game_match")
        .values({ server_id: 0 })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("game_match_player")
        .values(
          players.map((user_id) => ({
            match_id: id,
            user_id,
            signals: JSON.stringify([{ kind: "focus", round: 1, ms: null }]),
          })),
        )
        .execute();
      return id;
    };
    const alone = await match([guest]);
    const both = await match([guest, account]);
    await trx
      .insertInto("fair_play_flag")
      .values([
        { match_id: alone, user_id: guest, signals: 4 },
        { match_id: both, user_id: guest, signals: 3 },
        { match_id: both, user_id: account, signals: 5 },
      ])
      .execute();
    // A match against its own account where only the guest was flagged: the flag
    // stays behind (and goes with the guest), so no penalty can reach the account's
    // own run of it.
    const selfMatch = await match([guest, account]);
    await trx
      .insertInto("fair_play_flag")
      .values({ match_id: selfMatch, user_id: guest, signals: 6 })
      .execute();
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    expect(
      await trx
        .selectFrom("game_match_player")
        .select(["signals"])
        .where("match_id", "=", alone)
        .executeTakeFirstOrThrow(),
    ).toEqual({ signals: [{ kind: "focus", round: 1, ms: null }] });
    expect(
      await trx
        .selectFrom("fair_play_flag")
        .select(["match_id", "user_id", "signals"])
        .where("match_id", "in", [alone, both, selfMatch])
        .orderBy("signals")
        .execute(),
    ).toEqual([
      { match_id: alone, user_id: account, signals: 4 },
      { match_id: both, user_id: account, signals: 5 },
    ]);
  });
});

// A penalty taken from a guest's rating that the account doesn't keep was never taken
// from the account's: it doesn't follow the guest.
test("a guest's penalty follows only the rating it was taken from", async () => {
  await inRollback(async (trx, { guest, account }) => {
    const match = async () => {
      const { id } = await trx
        .insertInto("game_match")
        .values({ server_id: 0 })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("game_match_player")
        .values({ match_id: id, user_id: guest })
        .execute();
      return id;
    };
    const [penalized, pending] = [await match(), await match()];
    await trx
      .insertInto("fair_play_flag")
      .values([
        {
          match_id: penalized,
          user_id: guest,
          signals: 3,
          decision: "penalized",
          decided_at: new Date(),
          penalty: 12,
        },
        { match_id: pending, user_id: guest, signals: 3 },
      ])
      .execute();
    // The account has played more: its rating is the one kept.
    await trx
      .insertInto("player_rating")
      .values([
        { user_id: guest, rating: 1550, rd: 200, volatility: 0.06, games: 1 },
        { user_id: account, rating: 1500, rd: 100, volatility: 0.06, games: 9 },
      ])
      .execute();
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    expect(
      await trx
        .selectFrom("fair_play_flag")
        .select(["match_id", "decision"])
        .where("match_id", "in", [penalized, pending])
        .execute(),
    ).toEqual([{ match_id: pending, decision: null }]);
  });
});

// P3-W16-S01 (ADR-0034; owner, 2026-11-02): the account keeps the more-played rating,
// with that rating's own history only.
test("the more-played rating stays with the account, with its own history", async () => {
  await inRollback(async (trx, { guest, account }) => {
    const rating = (user_id: string, rating: number, games: number) =>
      trx
        .insertInto("player_rating")
        .values({ user_id, rating, rd: 120, volatility: 0.06, games })
        .execute();
    await rating(guest, 1620, 9);
    await rating(account, 1480, 2);
    const { id: shared } = await trx
      .insertInto("game_match")
      .values({ server_id: 0 })
      .returning("id")
      .executeTakeFirstOrThrow();
    const { id: own } = await trx
      .insertInto("game_match")
      .values({ server_id: 0 })
      .returning("id")
      .executeTakeFirstOrThrow();
    const history = (user_id: string, match_id: string, after: number) =>
      trx
        .insertInto("rating_history")
        .values({
          user_id,
          match_id,
          rating_before: 1500,
          rating_after: after,
          rd_after: 120,
          volatility_after: 0.06,
          score: 1,
        })
        .execute();
    await history(guest, own, 1620);
    await history(guest, shared, 1600);
    await history(account, shared, 1480);
    // P3-W16-S06: closed seasons' final boards follow the surviving rating too.
    await trx
      .insertInto("season_close")
      .values({ season: "2031-03" })
      .execute();
    await trx
      .insertInto("season_standing")
      .values([
        { season: "2031-03", user_id: guest, rating: 1610 },
        { season: "2031-03", user_id: account, rating: 1470 },
      ])
      .execute();
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    expect(
      await trx
        .selectFrom("season_standing")
        .select(["user_id", "rating"])
        .where("season", "=", "2031-03")
        .execute(),
    ).toEqual([{ user_id: account, rating: 1610 }]);
    expect(
      await trx
        .selectFrom("player_rating")
        .select(["user_id", "rating", "games"])
        .where("user_id", "in", [guest, account])
        .execute(),
    ).toEqual([{ user_id: account, rating: 1620, games: 9 }]);
    // Only the surviving rating's history: it chains to the rating kept.
    const rows = await trx
      .selectFrom("rating_history")
      .select(["match_id", "rating_after"])
      .where("user_id", "=", account)
      .orderBy("rating_after")
      .execute();
    expect(rows).toEqual([
      { match_id: shared, rating_after: 1600 },
      { match_id: own, rating_after: 1620 },
    ]);
  });
});

test("an account with no rating takes the guest's", async () => {
  await inRollback(async (trx, { guest, account }) => {
    await trx
      .insertInto("player_rating")
      .values({
        user_id: guest,
        rating: 1555,
        rd: 200,
        volatility: 0.06,
        games: 1,
      })
      .execute();
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    expect(
      await trx
        .selectFrom("player_rating")
        .select(["rating", "games"])
        .where("user_id", "=", account)
        .executeTakeFirstOrThrow(),
    ).toEqual({ rating: 1555, games: 1 });
  });
});

test("a less-played guest leaves the account's rating as it was", async () => {
  await inRollback(async (trx, { guest, account }) => {
    await trx
      .insertInto("player_rating")
      .values([
        { user_id: guest, rating: 1700, rd: 300, volatility: 0.06, games: 1 },
        { user_id: account, rating: 1450, rd: 90, volatility: 0.06, games: 30 },
      ])
      .execute();
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    expect(
      await trx
        .selectFrom("player_rating")
        .select(["rating", "games"])
        .where("user_id", "=", account)
        .executeTakeFirstOrThrow(),
    ).toEqual({ rating: 1450, games: 30 });
  });
});

test("merging again, or merging a non-guest, changes nothing", async () => {
  await inRollback(async (trx, { guest, account, questions }) => {
    const played = await dailyPlayed(trx, guest, 3, questions, 2);
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    expect(await mergeGuest(trx, guest, account)).toBe(false);
    // An account is never merged away, whatever the caller asks.
    expect(await mergeGuest(trx, account, guest)).toBe(false);
    expect(await owner(trx, played)).toBe(account);
  });
});

test("estimates score as the game does: half a point rounds up", async () => {
  await inRollback(async (trx, { guest, account, questions }) => {
    const [question] = questions;
    if (question === undefined) throw new Error("questions");
    // One estimate each, the same day: 12.5 points round to 13 (as Math.round does),
    // beating 12; rounding half to even would call it a tie and keep the account's.
    const played = async (userId: string, score: number) => {
      const id = await dailyPlayed(trx, userId, 3, [], 0);
      await sql`insert into quiz_answer
          (attempt_id, question_id, served_at, answered_at, guess, score)
        values (${id}, ${question}, now() - interval '150 minutes',
                now() - interval '149 minutes', 10, ${score})`.execute(trx);
      return id;
    };
    const guestDay = await played(guest, 0.125);
    const accountDay = await played(account, 0.12);
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    expect(await owner(trx, guestDay)).toBe(account);
    expect(await owner(trx, accountDay)).toBeUndefined();
  });
});
