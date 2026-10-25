import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import type { Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminSources } from "./kysely-admin-sources";

// P1-W3-S06 against the real schema and its purge trigger; rolled back per case.
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

test("switching moments off purges them; switching back restores the seeded value", async () => {
  await rolledBack(async (trx) => {
    const tag = randomUUID().slice(0, 8);
    const source = await trx
      .insertInto("source")
      .values({
        name: `switch-${tag}`,
        feed_url: `https://switch-${tag}.example.test/feed`,
        rights_profile: "full_text_internal",
        moments_seeded: true,
        moments_enabled: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const item = await trx
      .insertInto("content_item")
      .values({
        source_id: source.id,
        guid: `switch-${tag}`,
        canonical_url: `https://switch-${tag}.example.test/p`,
        title: "P",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("content_item_private_text")
      .values({ content_item_id: item.id, text: "body" })
      .execute();
    await trx
      .insertInto("moment")
      .values({
        content_item_id: item.id,
        ordinal: 0,
        title: "P",
        estimated_minutes: 1,
        link: "https://x.test/p",
        link_type: "page_top",
      })
      .execute();
    const sources = kyselyAdminSources(trx);
    await sources.setMomentsSwitchedOff(source.id, true, "admin-1");
    expect(await sources.get(source.id)).toMatchObject({
      momentsSwitchedOff: true,
      momentsEnabled: false,
    });
    const left = await trx
      .selectFrom("moment")
      .select("id")
      .where("content_item_id", "=", item.id)
      .execute();
    expect(left).toEqual([]);
    expect(await sources.fullTextItemIds(source.id)).toEqual([item.id]);
    await sources.setMomentsSwitchedOff(source.id, false, "admin-1");
    expect(await sources.get(source.id)).toMatchObject({
      momentsEnabled: true,
    });
    expect((await sources.list()).some((s) => s.id === source.id)).toBe(true);
    expect(await sources.get("nope")).toBeNull();
  });
});
