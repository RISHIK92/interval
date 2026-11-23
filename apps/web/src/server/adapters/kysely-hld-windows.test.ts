import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyHldWindows } from "./kysely-hld-windows";

// P6-W42 (MATCH-7, Q-P6-06): HLD's ranked windows: registration per battle mode, a claim
// once per window (its variant picked by the first), players by HLD room rating.
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

async function players(trx: Kysely<DB>, n: number): Promise<string[]> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `HLDW${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: n,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const ids = Array.from({ length: n }, () => `hldw-${randomUUID()}`);
  await trx
    .insertInto("app_user")
    .values(
      ids.map((id) => ({
        id,
        name: id.slice(0, 9),
        email: `${id}@hldw.example.test`,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  return ids;
}

test("registrants are claimed once, best rated first, on one variant", async () => {
  await inRollback(async (trx) => {
    const windows = kyselyHldWindows(trx);
    const [ada = "", bob = "", cy = ""] = await players(trx, 3);
    const at = new Date("2030-01-01T21:00:00Z");
    await windows.register(at, ada, "human");
    await windows.register(at, bob, "ai");
    await windows.register(at, bob, "human"); // moved, before grouping
    await windows.register(at, cy, "human");
    await windows.unregister(at, cy);
    await trx
      .insertInto("hld_room_rating")
      .values({ user_id: bob, battle_mode: "human", mu: 30, sigma: 5 })
      .execute();
    const pick = () => ({ family: "chat", seed: 3 });
    const claimed = await windows.claim(at, "human", at, pick);
    expect(claimed?.variant).toEqual({ family: "chat", seed: 3 });
    expect(claimed?.players.map((p) => p.userId)).toEqual([bob, ada]);
    // Another caller within the minute gets nothing.
    expect(await windows.claim(at, "human", at, pick)).toBeNull();
    expect(await windows.registration(at, bob)).toEqual({
      matchId: null,
      battleMode: "human",
    });
    expect(await windows.registration(at, cy)).toBeNull();
  });
});
