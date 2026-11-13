import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyBattleWindows } from "./kysely-battle-windows";

// P5-W32 (§6.6, MATCH-7; Q-P5-19): registrations, and a window's grouping claimed by
// one poll, its ungrouped players best room rating first; a stale claim retaken.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(body: (trx: Kysely<DB>) => Promise<void>) {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
}

async function seed(trx: Kysely<DB>) {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `WIN${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 3,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const users = [1, 2, 3].map(() => `win-${randomUUID()}`);
  await trx
    .insertInto("app_user")
    .values(
      users.map((id) => ({
        id,
        name: id,
        email: `${id}@win.example.test`,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  const slug = `win-${randomUUID().slice(0, 8)}`;
  const hash = "a".repeat(64);
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
  return { users, slug };
}

// Far from any real window: the tables are shared.
const AT = new Date("2099-01-01T15:30:00Z");
const later = (seconds: number) => new Date(AT.getTime() + seconds * 1000);

test("one poll claims a window, players best room rating first; a stale claim is retaken", async () => {
  await inRollback(async (trx) => {
    const { users, slug } = await seed(trx);
    const [a, b, c] = users as [string, string, string];
    const windows = kyselyBattleWindows(trx);
    for (const u of users) await windows.register(AT, u, later(-900), "human");
    await trx
      .insertInto("room_rating")
      .values({ user_id: c, league: "human", mu: 31, sigma: 5, games: 2 })
      .execute();
    expect(await windows.registration(AT, a)).toEqual({
      matchId: null,
      league: "human",
    });
    const claimed = await windows.claim(AT, "human", AT, () =>
      Promise.resolve(slug),
    );
    expect(claimed?.problem).toBe(slug);
    expect(claimed?.first).toBe(true);
    expect(claimed?.players.map((p) => p.userId)).toEqual([c, a, b]);
    expect(claimed?.players[0]?.rating).toBe(31);
    // Another poll meanwhile: not its to do.
    expect(
      await windows.claim(AT, "human", later(10), () => Promise.resolve("x")),
    ).toBeNull();
    // c and a grouped; b's group failed. A minute on, b is taken up again.
    const { id: match } = await trx
      .insertInto("game_match")
      .values({ server_id: 0, mode: "battle", problem_slug: slug })
      .returning("id")
      .executeTakeFirstOrThrow();
    await windows.assign(AT, "human", match, [c, a]);
    expect(await windows.registration(AT, a)).toEqual({
      matchId: match,
      league: "human",
    });
    expect(
      await windows.claim(AT, "human", later(30), () => Promise.resolve("x")),
    ).toBeNull();
    const again = await windows.claim(AT, "human", later(75), () =>
      Promise.resolve("x"),
    );
    expect(again).toEqual({
      problem: slug,
      players: [{ userId: b, rating: 25 }],
      first: false,
    });
    // A grouped player can't take their registration back.
    await windows.unregister(AT, a);
    expect(await windows.registration(AT, a)).toEqual({
      matchId: match,
      league: "human",
    });
  });
});
