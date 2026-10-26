import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyProgress } from "./kysely-progress";

// Finishes (§5D, C-22, P1-W5-S02): the first is kept; a repeat changes nothing.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

type Seeded = {
  userId: string;
  itemId: string;
  sourceId: string;
  momentIds: string[];
};

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const source = await trx
        .insertInto("source")
        .values({
          name: `prog-${randomUUID()}`,
          feed_url: "https://prog.example.test/feed.xml",
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
          guid: "prog-1",
          canonical_url: "https://prog.example.test/post",
          title: "Consensus in practice",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moments = await trx
        .insertInto("moment")
        .values(
          ["Intro", "Raft", "Paxos"].map((title, ordinal) => ({
            content_item_id: item.id,
            ordinal,
            title,
            estimated_minutes: 3,
            link: `https://prog.example.test/post#${title.toLowerCase()}`,
            link_type: "anchor" as const,
          })),
        )
        .returning("id")
        .execute();
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `PROG${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 1,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const userId = randomUUID();
      await trx
        .insertInto("app_user")
        .values({
          id: userId,
          name: "n",
          email: `${userId}@example.test`,
          beta_group: "student",
          invite_code_id: code.id,
        })
        .execute();
      await body(trx, {
        userId,
        itemId: item.id,
        sourceId: source.id,
        momentIds: moments.map((m) => m.id),
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("a section or an article is finished once; a repeat changes nothing", async () => {
  await inRollback(async (trx, { userId, itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [first] = momentIds;
    if (first === undefined) throw new Error("seed");
    expect(
      await progress.finishMoment(userId, itemId, first, "return_prompt"),
    ).toBe(true);
    expect(
      await progress.finishMoment(userId, itemId, first, "mark_done"),
    ).toBe(false);
    expect(await progress.finishArticle(userId, itemId, "mark_done")).toBe(
      true,
    );
    expect(await progress.finishArticle(userId, itemId, "mark_done")).toBe(
      false,
    );
    const kept = await trx
      .selectFrom("user_moment_finished")
      .select("method")
      .where("user_id", "=", userId)
      .execute();
    expect(kept).toEqual([{ method: "return_prompt" }]);
    expect(
      await progress.finishMoment(userId, itemId, "999999999999", "mark_done"),
    ).toBe(false);
    expect(
      await progress.finishArticle(userId, "999999999999", "mark_done"),
    ).toBe(false);
  });
});

test("the next section follows by order; the last has none", async () => {
  await inRollback(async (trx, { itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro, raft, paxos] = momentIds;
    if (intro === undefined || raft === undefined || paxos === undefined) {
      throw new Error("seed");
    }
    expect(await progress.nextMoment(itemId, intro)).toEqual({
      momentId: raft,
      title: "Raft",
    });
    expect(await progress.nextMoment(itemId, paxos)).toBeNull();
  });
});

test("describe names the section and article, or nothing for a stranger's ids", async () => {
  await inRollback(async (trx, { itemId, momentIds }) => {
    const progress = kyselyProgress(trx);
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    expect(await progress.describe(itemId, intro)).toEqual({
      articleTitle: "Consensus in practice",
      sectionTitle: "Intro",
    });
    expect(await progress.describe(itemId, null)).toEqual({
      articleTitle: "Consensus in practice",
      sectionTitle: null,
    });
    expect(await progress.describe("999999999999", null)).toBeNull();
    expect(await progress.describe("999999999999", intro)).toBeNull();
  });
});

test("a section is finished only under its own article", async () => {
  await inRollback(async (trx, { userId, momentIds }) => {
    const [first] = momentIds;
    if (first === undefined) throw new Error("seed");
    expect(
      await kyselyProgress(trx).finishMoment(
        userId,
        "999999999999",
        first,
        "mark_done",
      ),
    ).toBe(false);
  });
});

test("sections of a source that no longer allows moments are not named (ING-2)", async () => {
  await inRollback(async (trx, { itemId, sourceId, momentIds }) => {
    const [intro] = momentIds;
    if (intro === undefined) throw new Error("seed");
    // Profile change without the purge trigger: a stale moment row is left behind.
    await sql`set local session_replication_role = replica`.execute(trx);
    await trx
      .updateTable("source")
      .set({ rights_profile: "metadata_only" })
      .where("id", "=", sourceId)
      .execute();
    await sql`set local session_replication_role = origin`.execute(trx);
    const progress = kyselyProgress(trx);
    expect(await progress.describe(itemId, intro)).toBeNull();
    expect(await progress.nextMoment(itemId, intro)).toBeNull();
    expect(await progress.describe(itemId, null)).toEqual({
      articleTitle: "Consensus in practice",
      sectionTitle: null,
    });
  });
});
