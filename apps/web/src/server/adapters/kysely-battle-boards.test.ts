import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyBattleBoards } from "./kysely-battle-boards";

// P5-W33 (§6.7, Q-P5-20): a league's boards this season: 1v1 by rating, rooms by
// OpenSkill's ordinal; nobody unrated or rated only before the season.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

test("this season's boards per league and kind, the viewer marked", async () => {
  await expect(
    db.transaction().execute(async (trx: Kysely<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `BRD${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 3,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [a, b, c] = [1, 2, 3].map(() => `brd-${randomUUID()}`) as [
        string,
        string,
        string,
      ];
      await trx
        .insertInto("app_user")
        .values(
          [a, b, c].map((id, i) => ({
            id,
            name: ["Ada", "Bob", "Cy"][i] ?? "",
            email: `${id}@brd.example.test`,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      // Far in the future: other tests' ratings are older than this "season".
      const season = new Date("2099-01-01T00:00:00Z");
      const now = new Date("2099-01-05T00:00:00Z");
      await trx
        .insertInto("battle_rating")
        .values([
          {
            user_id: a,
            league: "ai",
            rating: 1600,
            rd: 90,
            volatility: 0.06,
            games: 3,
            updated_at: now,
          },
          {
            user_id: b,
            league: "ai",
            rating: 1700,
            rd: 90,
            volatility: 0.06,
            games: 1,
            updated_at: now,
          },
          // Rated only before the season: not on it.
          {
            user_id: c,
            league: "ai",
            rating: 1900,
            rd: 90,
            volatility: 0.06,
            games: 9,
            updated_at: new Date("2098-12-30"),
          },
        ])
        .execute();
      await trx
        .insertInto("room_rating")
        .values({
          user_id: a,
          league: "ai",
          mu: 30,
          sigma: 2,
          games: 1,
          updated_at: now,
        })
        .execute();
      // Only rated battles this season put a player on its board (the season's reset
      // touches every rating): a, b and a's room; c's last was before.
      const match = async (league: "human" | "ai") =>
        (
          await trx
            .insertInto("game_match")
            .values({ server_id: 0, league })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      const history = (user_id: string, match_id: string, at: Date) => ({
        match_id,
        user_id,
        league: "ai",
        rating_before: 1500,
        rating_after: 1550,
        rd_after: 90,
        volatility_after: 0.06,
        score: 1,
        at,
      });
      const m1 = await match("ai");
      const m0 = await match("ai");
      await trx
        .insertInto("battle_rating_history")
        .values([
          history(a, m1, now),
          history(b, m1, now),
          history(c, m0, new Date("2098-12-30")),
        ])
        .execute();
      await trx
        .insertInto("room_rating_history")
        .values({
          match_id: m1,
          user_id: a,
          league: "ai",
          mu_before: 25,
          mu_after: 30,
          sigma_after: 2,
          rank: 1,
          at: now,
        })
        .execute();
      const boards = kyselyBattleBoards(trx);
      expect(await boards.top("ai", "duel", season, a, 10)).toEqual([
        { name: "Bob", rating: 1700, you: false },
        { name: "Ada", rating: 1600, you: true },
      ]);
      expect(await boards.top("ai", "room", season, a, 10)).toEqual([
        { name: "Ada", rating: 24, you: true },
      ]);
      expect(
        (await boards.top("human", "duel", season, a, 10)).filter((r) => r.you),
      ).toEqual([]);
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
});
