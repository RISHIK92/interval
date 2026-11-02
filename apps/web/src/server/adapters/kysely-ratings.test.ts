import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyRatings } from "./kysely-ratings";

// P3-W16-S01, S02: a player's rating for matchmaking; 1500 before their first match.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

test("a rated player's rating, or 1500 before any match", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `RATE${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 2,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [rated, fresh] = [`rate-${randomUUID()}`, `rate-${randomUUID()}`];
      await trx
        .insertInto("app_user")
        .values(
          [rated, fresh].map((id) => ({
            id,
            name: "Ada",
            email: `${id}@rate.example.test`,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      await trx
        .insertInto("player_rating")
        .values({
          user_id: rated,
          rating: 1612.4,
          rd: 80,
          volatility: 0.06,
          games: 9,
        })
        .execute();
      const ratings = kyselyRatings(trx);
      expect(await ratings.of(rated)).toBe(1612.4);
      expect(await ratings.of(fresh)).toBe(1500);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});
