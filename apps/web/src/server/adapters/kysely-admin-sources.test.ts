import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import type { Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminSources } from "./kysely-admin-sources";

// The admin's list of sources, against the real schema; rolled back per case.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function rolledBack(body: (trx: Transaction<DB>) => Promise<void>) {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

// ADR-0058: what's left without the moments switch is each source's rights and
// whether the seed file still has it.
test("sources are listed with their rights and whether they're in the seed file", async () => {
  await rolledBack(async (trx) => {
    const tag = randomUUID().slice(0, 8);
    const source = await trx
      .insertInto("source")
      .values({
        name: `list-${tag}`,
        feed_url: `https://list-${tag}.example.test/feed`,
        rights_profile: "metadata_only",
        active: false,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(
      (await kyselyAdminSources(trx).list()).find((s) => s.id === source.id),
    ).toEqual({
      id: source.id,
      name: `list-${tag}`,
      rightsProfile: "metadata_only",
      active: false,
    });
  });
});
