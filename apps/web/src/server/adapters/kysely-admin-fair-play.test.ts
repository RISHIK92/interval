import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminFairPlay } from "./kysely-admin-fair-play";
import { kyselyRatings } from "./kysely-ratings";

// P3-W18-S02 (§6.9, Q-P3-20; owner, 2026-11-05): flags wait for review; a penalty
// removes only the rating the match gained, and the player's ghost run of it.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

type Seeded = { admin: string; ada: string; bob: string; match: string };

async function seed(trx: Kysely<DB>, adaGained: number): Promise<Seeded> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `FAIR${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 3,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const [admin, ada, bob] = [1, 2, 3].map(() => `fair-${randomUUID()}`) as [
    string,
    string,
    string,
  ];
  await trx
    .insertInto("app_user")
    .values(
      [admin, ada, bob].map((id, i) => ({
        id,
        name: ["Owner", "Ada", "Bob"][i] ?? "",
        email: `${id}@fair.example.test`,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  await trx
    .insertInto("player_username")
    .values({ user_id: ada, username: `ada_${randomUUID().slice(0, 6)}` })
    .execute();
  const { id: match } = await trx
    .insertInto("game_match")
    .values({ server_id: 0, mode: "fastest_finger" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("game_match_player")
    .values([
      {
        match_id: match,
        user_id: ada,
        signals: JSON.stringify([
          { kind: "speed", round: 1, ms: 210 },
          { kind: "focus", round: 2, ms: null },
          { kind: "speed", round: 3, ms: 90 },
        ]),
      },
      { match_id: match, user_id: bob, signals: JSON.stringify([]) },
    ])
    .execute();
  await trx
    .insertInto("player_rating")
    .values([
      { user_id: ada, rating: 1600, rd: 120, volatility: 0.06, games: 4 },
      { user_id: bob, rating: 1480, rd: 120, volatility: 0.06, games: 4 },
    ])
    .execute();
  await trx
    .insertInto("rating_history")
    .values([
      {
        user_id: ada,
        match_id: match,
        rating_before: 1600 - adaGained,
        rating_after: 1600,
        rd_after: 120,
        volatility_after: 0.06,
        score: adaGained > 0 ? 1 : 0,
      },
      {
        user_id: bob,
        match_id: match,
        rating_before: 1500,
        rating_after: 1480,
        rd_after: 120,
        volatility_after: 0.06,
        score: 0,
      },
    ])
    .execute();
  await trx
    .insertInto("ghost_run")
    .values({
      match_id: match,
      user_id: ada,
      mode: "fastest_finger",
      rating: 1600 - adaGained,
      rd: 120,
      volatility: 0.06,
      answers: JSON.stringify([]),
    })
    .execute();
  await trx
    .insertInto("fair_play_flag")
    .values({ match_id: match, user_id: ada, signals: 3 })
    .execute();
  return { admin, ada, bob, match };
}

async function inRollback(
  adaGained: number,
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx, await seed(trx, adaGained));
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
}

const rating = async (trx: Kysely<DB>, userId: string) =>
  (
    await trx
      .selectFrom("player_rating")
      .select("rating")
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow()
  ).rating;

const mine = <T extends { matchId: string }>(rows: T[], match: string) =>
  rows.filter((r) => r.matchId === match);

test("a pending flag shows the player, the match, its signals and the gain", async () => {
  await inRollback(24, async (trx, { ada, match }) => {
    const [row, ...rest] = mine(
      await kyselyAdminFairPlay(trx).pending(),
      match,
    );
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      userId: ada,
      matchId: match,
      mode: "fastest_finger",
      gain: 24,
      signals: [
        { kind: "speed", round: 1, ms: 210 },
        { kind: "focus", round: 2, ms: null },
        { kind: "speed", round: 3, ms: 90 },
      ],
    });
    expect(row?.player).toMatch(/^ada_/);
    expect(row?.playedAt).toBeInstanceOf(Date);
  });
});

test("a penalty removes only the match's gain, and the player's ghost run of it", async () => {
  await inRollback(24, async (trx, { admin, ada, bob, match }) => {
    const fair = kyselyAdminFairPlay(trx);
    const [row] = mine(await fair.pending(), match);
    expect(await fair.decide(row?.id ?? "", admin, "penalize")).toEqual({
      userId: ada,
    });
    expect(await rating(trx, ada)).toBe(1576);
    expect(await rating(trx, bob)).toBe(1480); // the opponent is untouched
    const runs = await trx
      .selectFrom("ghost_run")
      .select("id")
      .where("match_id", "=", match)
      .execute();
    expect(runs).toEqual([]);
    expect(mine(await fair.pending(), match)).toEqual([]);
    // Decided once: a second decision changes nothing.
    expect(await fair.decide(row?.id ?? "", admin, "penalize")).toBeNull();
    expect(await rating(trx, ada)).toBe(1576);
    expect(await kyselyRatings(trx).adjustments(ada)).toEqual([
      { penalty: 24, playedAt: expect.any(Date) as Date },
    ]);
    expect(await kyselyRatings(trx).adjustments(bob)).toEqual([]);
  });
});

test("a match that lost the player rating is penalised by nothing", async () => {
  await inRollback(-30, async (trx, { admin, ada, match }) => {
    const fair = kyselyAdminFairPlay(trx);
    const [row] = mine(await fair.pending(), match);
    expect(row?.gain).toBe(0);
    await fair.decide(row?.id ?? "", admin, "penalize");
    expect(await rating(trx, ada)).toBe(1600);
    expect(await kyselyRatings(trx).adjustments(ada)).toEqual([
      { penalty: 0, playedAt: expect.any(Date) as Date },
    ]);
  });
});

test("a dismissal changes no rating and keeps the run", async () => {
  await inRollback(24, async (trx, { admin, ada, match }) => {
    const fair = kyselyAdminFairPlay(trx);
    const [row] = mine(await fair.pending(), match);
    expect(await fair.decide(row?.id ?? "", admin, "dismiss")).toEqual({
      userId: ada,
    });
    expect(await rating(trx, ada)).toBe(1600);
    const runs = await trx
      .selectFrom("ghost_run")
      .select("id")
      .where("match_id", "=", match)
      .execute();
    expect(runs).toHaveLength(1);
    expect(mine(await fair.pending(), match)).toEqual([]);
    expect(await kyselyRatings(trx).adjustments(ada)).toEqual([]);
  });
});

// P5-W31-S04a (Q-P5-17): a battle's flag, with its paste and away signals.
test("a battle's flag shows its pastes and aways", async () => {
  await inRollback(0, async (trx, { bob }) => {
    const slug = `fair-${randomUUID().slice(0, 8)}`;
    const hash = "f".repeat(64);
    await trx
      .insertInto("lld_problem")
      .values({
        slug,
        title: "A problem",
        difficulty: "easy",
        statement: "# A problem",
        interface: JSON.stringify({}),
        limits: JSON.stringify({}),
        visible: JSON.stringify([]),
        private_key: `lld/problems/${slug}/${hash}.json`,
        content_hash: hash,
      })
      .execute();
    const { id: battle } = await trx
      .insertInto("game_match")
      .values({ server_id: 0, mode: "battle", problem_slug: slug })
      .returning("id")
      .executeTakeFirstOrThrow();
    const signals = [
      { kind: "paste", round: 7, ms: null, chars: 640 },
      { kind: "away", round: 12, ms: 41_000 },
    ];
    await trx
      .insertInto("game_match_player")
      .values({
        match_id: battle,
        user_id: bob,
        signals: JSON.stringify(signals),
      })
      .execute();
    await trx
      .insertInto("fair_play_flag")
      .values({ match_id: battle, user_id: bob, signals: 1 })
      .execute();
    const admin = kyselyAdminFairPlay(trx);
    const [row] = mine(await admin.pending(), battle);
    expect(row).toMatchObject({ mode: "battle", gain: 0, signals });
    // No penalty for a battle until it's rated (W32); it can be dismissed.
    expect(await admin.decide(row?.id ?? "", bob, "penalize")).toBeNull();
    expect(await admin.decide(row?.id ?? "", bob, "dismiss")).toEqual({
      userId: bob,
    });
  });
});
