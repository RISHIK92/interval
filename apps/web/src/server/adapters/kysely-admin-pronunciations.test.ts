import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminPronunciations } from "./kysely-admin-pronunciations";

// P4-W22-S02 (TTS-2): the owner adds and removes terms; the seed's stay.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(
  body: (trx: Transaction<DB>, admin: string, tag: string) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `PRON${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 1,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const admin = randomUUID();
      await trx
        .insertInto("app_user")
        .values({
          id: admin,
          name: "n",
          email: `${admin}@example.test`,
          beta_group: "student",
          invite_code_id: code.id,
        })
        .execute();
      await body(trx, admin, `zz${randomUUID().slice(0, 6)}`);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("a term is added once in any case; only the admin's can be removed", async () => {
  await inRollback(async (trx, admin, tag) => {
    await trx
      .insertInto("pronunciation")
      .values({ term: `${tag}-seed`, say: "seed", origin: "seed" })
      .execute();
    const store = kyselyAdminPronunciations(trx);
    expect(await store.add(`${tag}-Mine`, "mine", admin)).toBe("added");
    expect(await store.add(`${tag}-MINE`, "again", admin)).toBe("taken");
    expect(await store.add(`${tag}-SEED`, "x", admin)).toBe("taken");
    const ours = (await store.list()).filter((p) => p.term.startsWith(tag));
    expect(ours.map((p) => [p.term, p.say, p.origin])).toEqual([
      [`${tag}-Mine`, "mine", "admin"],
      [`${tag}-seed`, "seed", "seed"],
    ]);
    const [mine, seed] = ours;
    if (mine === undefined || seed === undefined) throw new Error("seeded");
    expect(await store.remove(seed.id)).toBe(false);
    expect(await store.remove(mine.id)).toBe(true);
    expect(
      (await store.list()).filter((p) => p.term.startsWith(tag)),
    ).toHaveLength(1);
  });
});
