import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyLeagues } from "./kysely-leagues";

// ADR-0045: the Leagues page reads what the worker keeps: ranks and moves from the
// database's views, a member's week from the points ledger.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

const rollback = (body: (trx: Kysely<DB>) => Promise<void>) =>
  expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);

async function accounts(trx: Kysely<DB>, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => `league-${randomUUID()}`);
  await trx
    .insertInto("app_user")
    .values(
      ids.map((id) => ({
        id,
        name: "Ada",
        email: `${id}@leagues.example.test`,
      })),
    )
    .execute();
  return ids;
}

// A week far from any other data, its cohort, and each member's points rows.
const WEEK = "2032-01-05"; // a Monday
async function cohort(
  trx: Kysely<DB>,
  tier: "gold" | "bronze",
  members: [string, { reason: string; points: number; at: string }[]][],
): Promise<void> {
  const week = await sql<{ id: string }>`
    insert into league_week (starts_on, time_zone) values (${WEEK}::date, 'UTC')
    on conflict (starts_on) do update set time_zone = excluded.time_zone
    returning id
  `.execute(trx);
  const weekId = week.rows[0]?.id;
  const made = await sql<{ id: string }>`
    insert into league_cohort (week_id, tier, size)
    values (${weekId}, ${tier}, ${members.length}) returning id
  `.execute(trx);
  const cohortId = made.rows[0]?.id;
  for (const [user, rows] of members) {
    await sql`
      insert into league_member (week_id, cohort_id, user_id, pace_days, mid_week)
      values (${weekId}, ${cohortId}, ${user}, 0, true)
    `.execute(trx);
    for (const [n, row] of rows.entries())
      await sql`
        insert into league_points
          (user_id, week_id, source_kind, source_id, points, reason, at)
        values (${user}, ${weekId}, ${row.reason === "checkpoint" ? "checkpoint" : "match"},
          ${`${user}-${String(n)}`}, ${row.points}, ${row.reason}, ${row.at}::timestamptz)
      `.execute(trx);
  }
}

test("a placed player sees their cohort ranked, with each member's week", async () => {
  await rollback(async (trx) => {
    const [a, b, c, d] = await accounts(trx, 4);
    if (!a || !b || !c || !d) throw new Error("accounts");
    await trx
      .insertInto("player_username")
      .values({ user_id: b, username: `lg${randomUUID().slice(0, 8)}` })
      .execute();
    await trx
      .insertInto("league_player")
      .values(
        [a, b, c, d].map((user_id) => ({ user_id, tier: "gold" as const })),
      )
      .execute();
    await cohort(trx, "gold", [
      [
        a,
        [
          { reason: "match", points: 15, at: "2032-01-06T10:00Z" },
          { reason: "bot_match", points: 5, at: "2032-01-07T10:00Z" },
          { reason: "checkpoint", points: 10, at: "2032-01-07T11:00Z" },
        ],
      ],
      [b, [{ reason: "battle", points: 45, at: "2032-01-06T09:00Z" }]],
      [c, [{ reason: "match", points: 30, at: "2032-01-06T08:00Z" }]],
      [d, []],
    ]);
    const leagues = kyselyLeagues(trx);
    const seen = await leagues.standing(a, WEEK, new Date("2032-01-07T00:00Z"));
    expect(seen.tier).toBe("gold");
    expect(seen.cohort).not.toBeNull();
    const { size, up, down, rows } = seen.cohort ?? {
      size: 0,
      up: 0,
      down: 0,
      rows: [],
    };
    expect({ size, up, down }).toEqual({ size: 4, up: 1, down: 1 });
    expect(rows.map((r) => [r.userId, r.rank, r.points])).toEqual([
      [b, 1, 45],
      // a and c tie on 30: c reached it first.
      [c, 2, 30],
      [a, 3, 30],
      [d, 4, 0],
    ]);
    expect(rows[0]?.username).not.toBeNull();
    expect(rows[2]).toMatchObject({
      matches: 2,
      battles: 0,
      checkpoints: 1,
      today: 15,
    });
    expect(rows[0]).toMatchObject({ matches: 0, battles: 1 });
    expect(await leagues.pointsOf([a, b, d], WEEK)).toEqual(
      expect.arrayContaining([
        { userId: a, points: 30 },
        { userId: b, points: 45 },
      ]),
    );
    expect(await leagues.pointsOf([a, b, d], WEEK)).toHaveLength(2);
    expect(await leagues.pointsOf([], WEEK)).toEqual([]);
  });
});

test("before any league a player is Bronze with no cohort, and has no tier", async () => {
  await rollback(async (trx) => {
    const [a, b] = await accounts(trx, 2);
    if (!a || !b) throw new Error("accounts");
    const leagues = kyselyLeagues(trx);
    expect(await leagues.standing(a, WEEK, new Date())).toEqual({
      tier: "bronze",
      cohort: null,
    });
    expect(await leagues.tier(a)).toBeNull();
    // Moved up last week, not placed yet this week: their tier, no cohort.
    await trx
      .insertInto("league_player")
      .values({ user_id: b, tier: "ruby" })
      .execute();
    expect(await leagues.standing(b, WEEK, new Date())).toEqual({
      tier: "ruby",
      cohort: null,
    });
    expect(await leagues.tier(b)).toBe("ruby");
  });
});
