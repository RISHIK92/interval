import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyRanking } from "./kysely-ranking";

// P1-W6-S01 against the real schema; rolled back per case.
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

async function user(trx: Transaction<DB>): Promise<string> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `RANK${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 1,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const id = randomUUID();
  await trx
    .insertInto("app_user")
    .values({
      id,
      name: "n",
      email: `${id}@example.test`,
      beta_group: "developer",
      invite_code_id: code.id,
    })
    .execute();
  return id;
}

const parts = {
  values: { topic_match: 1, quality: 0.5 },
  weights: { topic_match: 1, quality: 0.4 },
  weighted: { topic_match: 1, quality: 0.2 },
  penalty: 0.25,
};

test("entries show the user's own feed for a chip, in rank order, with each breakdown", async () => {
  await rolledBack(async (trx) => {
    const tag = randomUUID().slice(0, 8);
    const source = await trx
      .insertInto("source")
      .values({
        name: `rank-${tag}`,
        feed_url: `https://rank-${tag}.example.test/feed`,
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
        guid: "g1",
        canonical_url: `https://rank-${tag}.example.test/post`,
        title: "Consensus in practice",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const moment = await trx
      .insertInto("moment")
      .values({
        content_item_id: item.id,
        ordinal: 0,
        title: "Raft in one page",
        estimated_minutes: 3,
        link: `https://rank-${tag}.example.test/post#raft`,
        link_type: "anchor",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const [me, other] = [await user(trx), await user(trx)];
    const entry = { content_item_id: item.id, top_signal: "topic_match" };
    await trx
      .insertInto("user_feed_entry")
      .values([
        { ...entry, user_id: me, chip: "3-8", rank: 2, moment_id: moment.id },
        {
          ...entry,
          user_id: me,
          chip: "3-8",
          rank: 1,
          moment_id: null,
          explore_kind: "topic",
          explore_arm: "backend",
          score_parts: JSON.stringify(parts),
        },
        { ...entry, user_id: me, chip: "1-3", rank: 1, moment_id: moment.id },
        { ...entry, user_id: other, chip: "3-8", rank: 1, moment_id: null },
      ])
      .execute();
    expect(await kyselyRanking(trx).entries(me, "3-8")).toEqual([
      {
        rank: 1,
        kind: "article",
        articleTitle: "Consensus in practice",
        sectionTitle: null,
        sourceName: `rank-${tag}`,
        topSignal: "topic_match",
        explored: { kind: "topic", arm: "backend" },
        breakdown: parts,
      },
      {
        rank: 2,
        kind: "moment",
        articleTitle: "Consensus in practice",
        sectionTitle: "Raft in one page",
        sourceName: `rank-${tag}`,
        topSignal: "topic_match",
        explored: null,
        breakdown: null,
      },
    ]);
  });
});

test("a breakdown in an older shape reads as none, not a broken page", async () => {
  await rolledBack(async (trx) => {
    const tag = randomUUID().slice(0, 8);
    const source = await trx
      .insertInto("source")
      .values({
        name: `rank-${tag}`,
        feed_url: `https://rank-${tag}.example.test/feed`,
        rights_profile: "full_text_internal",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const item = await trx
      .insertInto("content_item")
      .values({
        source_id: source.id,
        guid: "g1",
        canonical_url: `https://rank-${tag}.example.test/post`,
        title: "Old shape",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const me = await user(trx);
    await trx
      .insertInto("user_feed_entry")
      .values({
        user_id: me,
        chip: "1-3",
        rank: 1,
        content_item_id: item.id,
        moment_id: null,
        top_signal: "quality",
        score_parts: JSON.stringify({ values: {} }),
      })
      .execute();
    const [entry] = await kyselyRanking(trx).entries(me, "1-3");
    expect(entry?.breakdown).toBeNull();
  });
});

test("settings are every ranking_config row; a change reports whether it changed", async () => {
  await rolledBack(async (trx) => {
    const ranking = kyselyRanking(trx);
    const settings = await ranking.settings();
    expect(settings.map((s) => s.key)).toContain("weight.freshness");
    const freshness = settings.find((s) => s.key === "weight.freshness");
    expect(freshness?.note).toBeTruthy();
    expect(await ranking.setSetting("weight.freshness", 2.5)).toBe("changed");
    expect(
      (await ranking.settings()).find((s) => s.key === "weight.freshness")
        ?.value,
    ).toBe(2.5);
    expect(await ranking.setSetting("weight.freshness", 2.5)).toBe("unchanged");
    expect(await ranking.setSetting("weight.nothing", 1)).toBe("missing");
  });
});
