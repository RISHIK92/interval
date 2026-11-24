import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyBattleCode } from "./kysely-battle-code";

// Q-WD-17 (owner, 2026-11-23): a battle player's code per language, autosaved while the
// battle is open, for a reload or another device.
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
      code: `BCODE${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 2,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const [ada, bob] = [1, 2].map(() => `bcode-${randomUUID()}`) as [
    string,
    string,
  ];
  await trx
    .insertInto("app_user")
    .values(
      [ada, bob].map((id) => ({
        id,
        name: id === ada ? "Ada" : "Bob",
        email: `${id}@bcode.example.test`,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  const slug = `bcode-${randomUUID().slice(0, 8)}`;
  const hash = "c".repeat(64);
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
  const match = async (mode: "battle" | "practice") =>
    await trx
      .insertInto("game_match")
      .values({
        server_id: 0,
        mode,
        problem_slug: slug,
        unrated: mode === "practice",
      })
      .returning(["id", "created_at"])
      .executeTakeFirstOrThrow();
  const battle = await match("battle");
  const practice = await match("practice");
  await trx
    .insertInto("game_match_player")
    .values([
      { match_id: battle.id, user_id: ada },
      { match_id: practice.id, user_id: ada },
    ])
    .execute();
  return {
    ada,
    bob,
    battle: battle.id,
    practice: practice.id,
    at: battle.created_at,
  };
}

const later = (at: Date, seconds: number) =>
  new Date(at.getTime() + seconds * 1000);

test("a player of an open battle saves each language's code, the last save kept", async () => {
  await inRollback(async (trx) => {
    const { ada, battle, at } = await seed(trx);
    const code = kyselyBattleCode(trx);
    expect(await code.load(battle, ada)).toEqual({});
    expect(await code.save(battle, ada, "python", "v1", later(at, 10))).toBe(
      true,
    );
    expect(await code.save(battle, ada, "python", "v2", later(at, 20))).toBe(
      true,
    );
    expect(
      await code.save(battle, ada, "go", "package main", later(at, 30)),
    ).toBe(true);
    expect(await code.load(battle, ada)).toEqual({
      python: "v2",
      go: "package main",
    });
  });
});

test("only a player, only of an open battle: not another, a finished one, practice or past the hour", async () => {
  await inRollback(async (trx) => {
    const { ada, bob, battle, practice, at } = await seed(trx);
    const code = kyselyBattleCode(trx);
    expect(await code.save(battle, bob, "python", "x", later(at, 10))).toBe(
      false,
    );
    expect(await code.load(battle, bob)).toEqual({});
    expect(await code.save(practice, ada, "python", "x", later(at, 10))).toBe(
      false,
    );
    expect(await code.save(battle, ada, "python", "x", later(at, 3601))).toBe(
      false,
    );
    await trx
      .updateTable("game_match")
      .set({ finished_at: new Date(), outcome: "finished" })
      .where("id", "=", battle)
      .execute();
    expect(await code.save(battle, ada, "python", "x", later(at, 10))).toBe(
      false,
    );
    expect(await code.load(battle, ada)).toEqual({});
  });
});

test("at most one save a second per language, and an older one never overwrites newer code", async () => {
  await inRollback(async (trx) => {
    const { ada, battle, at } = await seed(trx);
    const code = kyselyBattleCode(trx);
    expect(await code.save(battle, ada, "python", "v1", later(at, 10))).toBe(
      true,
    );
    // Within the second: taken (the player is seated), not written.
    expect(await code.save(battle, ada, "python", "v2", later(at, 10.5))).toBe(
      true,
    );
    expect(await code.load(battle, ada)).toEqual({ python: "v1" });
    // Another language has its own second.
    expect(await code.save(battle, ada, "go", "g1", later(at, 10.5))).toBe(
      true,
    );
    expect(await code.save(battle, ada, "python", "v3", later(at, 12))).toBe(
      true,
    );
    // A request stamped before the last save (a slow one, arriving late).
    expect(await code.save(battle, ada, "python", "old", later(at, 5))).toBe(
      true,
    );
    expect(await code.load(battle, ada)).toEqual({ python: "v3", go: "g1" });
  });
});
