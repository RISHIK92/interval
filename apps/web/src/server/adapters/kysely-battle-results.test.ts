import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import {
  kyselyAdminDisputes,
  kyselyBattleResults,
} from "./kysely-battle-results";

// P5-W35 (§6.5, DB-6; Q-P5-14, Q-P5-22): a battle's results for its players: standings,
// replays once it's over, a review on request once, a dispute once within 7 days.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

test("a battle's results, replays, review and dispute, for its players only", async () => {
  await expect(
    db.transaction().execute(async (trx: Kysely<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `RES${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 3,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [ada, bob, eve] = [1, 2, 3].map(() => `res-${randomUUID()}`) as [
        string,
        string,
        string,
      ];
      await trx
        .insertInto("app_user")
        .values(
          [ada, bob, eve].map((id, i) => ({
            id,
            name: ["Ada", "Bob", "Eve"][i] ?? "",
            email: `${id}@res.example.test`,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      const slug = `res-${randomUUID().slice(0, 8)}`;
      const hash = "b".repeat(64);
      await trx
        .insertInto("lld_problem")
        .values({
          slug,
          title: "A problem",
          difficulty: "easy",
          statement: "# A",
          interface: JSON.stringify({}),
          limits: JSON.stringify({}),
          visible: JSON.stringify([]),
          private_key: `lld/problems/${slug}/${hash}.json`,
          content_hash: hash,
        })
        .execute();
      const { id: match } = await trx
        .insertInto("game_match")
        .values({ server_id: 0, mode: "battle", problem_slug: slug })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("game_match_player")
        .values([
          {
            match_id: match,
            user_id: ada,
            total: 1000,
            time_ms: "60000",
            place: 1,
          },
          {
            match_id: match,
            user_id: bob,
            total: 400,
            time_ms: "90000",
            place: 2,
          },
        ])
        .execute();
      await trx
        .insertInto("battle_snapshot")
        .values({
          match_id: match,
          user_id: bob,
          taken_at: new Date(),
          language: "go",
          key: `snap-${match}`,
          slot: 1,
        })
        .execute();
      const results = kyselyBattleResults(trx);
      expect(await results.of(match, eve)).toBeNull();
      const on = await results.of(match, ada);
      expect(on?.standings.map((s) => [s.name, s.place, s.you])).toEqual([
        ["Ada", 1, true],
        ["Bob", 2, false],
      ]);
      expect(on?.finishedAt).toBeNull();
      // While it's on: no replays, no review, no dispute.
      expect(await results.frames(match, ada)).toBeNull();
      expect(await results.requestReview(match, ada)).toBeNull();
      expect(await results.dispute(match, ada, "Unfair")).toBeNull();
      await trx
        .updateTable("game_match")
        .set({ finished_at: new Date(), outcome: "finished", winner_id: ada })
        .where("id", "=", match)
        .execute();
      expect((await results.frames(match, ada))?.map((f) => f.userId)).toEqual([
        bob,
      ]);
      expect(await results.frames(match, eve)).toBeNull();
      expect(await results.requestReview(match, ada)).toBe("no_code");
      await trx
        .insertInto("battle_best_submission")
        .values({
          match_id: match,
          user_id: ada,
          language: "go",
          key: `best-${match}`,
        })
        .execute();
      expect(await results.requestReview(match, ada)).toBe("requested");
      // Still pending (its job maybe lost): queued again.
      expect(await results.requestReview(match, ada)).toBe("pending");
      expect((await results.of(match, ada))?.review).toEqual({
        status: "pending",
        review: null,
      });
      expect(await results.dispute(match, bob, "The judge timed out.")).toBe(
        "disputed",
      );
      expect(await results.dispute(match, bob, "Again")).toBe("exists");
      expect((await results.of(match, bob))?.disputed).toBe(true);
      const admin = kyselyAdminDisputes(trx);
      const mine = (await admin.pending()).filter((d) => d.matchId === match);
      expect(mine.map((d) => [d.player, d.reason])).toEqual([
        ["Bob", "The judge timed out."],
      ]);
      expect(
        await admin.decide(match, bob, "dismissed", "Judged fine.", ada),
      ).toBe(true);
      expect(await admin.decide(match, bob, "upheld", "", ada)).toBe(false);
      const rate = await admin.rate();
      expect(rate.disputed).toBeGreaterThanOrEqual(1);
      expect(rate.finished).toBeGreaterThanOrEqual(rate.disputed);
      // Past 7 days, no new dispute.
      await trx
        .updateTable("game_match")
        .set({ finished_at: sql<Date>`now() - interval '8 days'` })
        .where("id", "=", match)
        .execute();
      expect(await results.dispute(match, ada, "Late")).toBe("late");
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
});
