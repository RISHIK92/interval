import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyBattleSnapshots } from "./kysely-battle-snapshots";

// P5-W31-S04b (§6.9, Q-P5-17): a battle player's snapshots, only while their battle is
// open and at most every 25 s; listed from a flag for review.
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

type Seeded = {
  ada: string;
  bob: string;
  battle: string;
  quiz: string;
  at: Date;
};

async function seed(trx: Kysely<DB>): Promise<Seeded> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `SNAP${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 2,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const [ada, bob] = [1, 2].map(() => `snap-${randomUUID()}`) as [
    string,
    string,
  ];
  await trx
    .insertInto("app_user")
    .values(
      [ada, bob].map((id) => ({
        id,
        name: id === ada ? "Ada" : "Bob",
        email: `${id}@snap.example.test`,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  const slug = `snap-${randomUUID().slice(0, 8)}`;
  const hash = "e".repeat(64);
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
  const { id: battle, created_at: at } = await trx
    .insertInto("game_match")
    .values({ server_id: 0, mode: "battle", problem_slug: slug })
    .returning(["id", "created_at"])
    .executeTakeFirstOrThrow();
  const { id: quiz } = await trx
    .insertInto("game_match")
    .values({ server_id: 0, mode: "sprint" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("game_match_player")
    .values([
      { match_id: battle, user_id: ada },
      { match_id: quiz, user_id: ada },
    ])
    .execute();
  return { ada, bob, battle, quiz, at };
}

const later = (at: Date, seconds: number) =>
  new Date(at.getTime() + seconds * 1000);

test("a player of an open battle snapshots at most every 25 s", async () => {
  await inRollback(async (trx) => {
    const { ada, battle, at } = await seed(trx);
    const snapshots = kyselyBattleSnapshots(trx);
    const first = later(at, 30);
    expect(await snapshots.claim(battle, ada, "python", first)).toBe(
      `battle-snapshots/${battle}/${ada}/${first.toISOString()}.json`,
    );
    expect(
      await snapshots.claim(battle, ada, "python", later(at, 50)),
    ).toBeNull();
    expect(
      await snapshots.claim(battle, ada, "go", later(at, 60)),
    ).not.toBeNull();
    // Posts racing past the gap check meet the 25-second slot's unique key.
    const slot = Math.floor(later(at, 60).getTime() / 1000 / 25);
    await expect(
      trx
        .insertInto("battle_snapshot")
        .values({
          match_id: battle,
          user_id: ada,
          taken_at: later(at, 60.5),
          language: "go",
          key: "raced",
          slot,
        })
        .execute(),
    ).rejects.toThrow(/unique/);
  });
});

test("nobody else, no other match, and no battle that's over", async () => {
  await inRollback(async (trx) => {
    const { ada, bob, battle, quiz, at } = await seed(trx);
    const snapshots = kyselyBattleSnapshots(trx);
    expect(
      await snapshots.claim(battle, bob, "python", later(at, 30)),
    ).toBeNull();
    expect(
      await snapshots.claim(quiz, ada, "python", later(at, 30)),
    ).toBeNull();
    // An hour on, a battle is over, its result or not.
    expect(
      await snapshots.claim(battle, ada, "python", later(at, 3601)),
    ).toBeNull();
    await trx
      .updateTable("game_match")
      .set({ finished_at: later(at, 600), outcome: "finished" })
      .where("id", "=", battle)
      .execute();
    expect(
      await snapshots.claim(battle, ada, "python", later(at, 700)),
    ).toBeNull();
  });
});

test("a flag lists its player's snapshots of its match, oldest first", async () => {
  await inRollback(async (trx) => {
    const { ada, battle, at } = await seed(trx);
    const snapshots = kyselyBattleSnapshots(trx);
    await snapshots.claim(battle, ada, "python", later(at, 30));
    await snapshots.claim(battle, ada, "go", later(at, 60));
    const { id } = await trx
      .insertInto("fair_play_flag")
      .values({ match_id: battle, user_id: ada, signals: 1 })
      .returning("id")
      .executeTakeFirstOrThrow();
    const listed = await snapshots.forFlag(id);
    expect(listed?.player).toBe("Ada");
    expect(listed?.snapshots.map((s) => [s.takenAt, s.language])).toEqual([
      [later(at, 30), "python"],
      [later(at, 60), "go"],
    ]);
    expect(await snapshots.forFlag("999999999")).toBeNull();
  });
});
