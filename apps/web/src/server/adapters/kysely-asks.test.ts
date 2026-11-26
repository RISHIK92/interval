import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import type { Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAsks } from "./kysely-asks";

// ADR-0046 (AI-3, LOAD-5, OPS-4): Explore's questions and the worker's answers.
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
  body: (trx: Transaction<DB>) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

async function user(trx: Transaction<DB>): Promise<string> {
  const id = randomUUID();
  await trx
    .insertInto("app_user")
    .values({ id, name: "Ada", email: `${id}@example.test` })
    .execute();
  return id;
}

const ask = (key: string, followUpOf: string | null = null) => ({
  text: "When should I shard?",
  chip: null,
  idempotencyKey: key,
  followUpOf,
});

test("the same key is the same question (LOAD-5)", async () => {
  await inRollback(async (trx) => {
    const asks = kyselyAsks(trx);
    const me = await user(trx);
    const first = await asks.submit(me, ask("k1"));
    expect(first).toEqual({ id: expect.any(String) as string, created: true });
    expect(await asks.submit(me, ask("k1"))).toEqual({
      ...(first as object),
      created: false,
    });
    expect(await asks.askedSince(me, new Date(Date.now() - 60_000))).toBe(1);
  });
});

test("a thread takes 3 follow-ups, and only on the user's own question", async () => {
  await inRollback(async (trx) => {
    const asks = kyselyAsks(trx);
    const me = await user(trx);
    const other = await user(trx);
    let parent = await asks.submit(me, ask("root"));
    for (let i = 1; i <= 3; i++) {
      if (typeof parent === "string") throw new Error(parent);
      parent = await asks.submit(me, ask(`f${String(i)}`, parent.id));
      if (typeof parent === "string") throw new Error(parent);
      expect((await asks.get(parent.id, me))?.depth).toBe(i);
    }
    if (typeof parent === "string") throw new Error(parent);
    expect(await asks.submit(me, ask("f4", parent.id))).toBe("thread_full");
    expect(await asks.submit(other, ask("x", parent.id))).toBe("no_thread");
    expect(await asks.get(parent.id, other)).toBeNull();
  });
});

test("an answer reads its citations' labels from the catalogue, dropping broken links", async () => {
  await inRollback(async (trx) => {
    const asks = kyselyAsks(trx);
    const me = await user(trx);
    const source = await trx
      .insertInto("source")
      .values({
        name: "DDIA",
        feed_url: `https://${randomUUID()}.example.test/feed.xml`,
        rights_profile: "full_text_internal",
        moments_seeded: true,
        moments_enabled: true,
        topics: ["distributed-systems"],
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const [item, broken] = await Promise.all(
      ["Designing data systems", "Gone"].map(async (title) =>
        trx
          .insertInto("content_item")
          .values({
            source_id: source.id,
            guid: randomUUID(),
            canonical_url: `https://example.test/${randomUUID()}`,
            title,
            link_broken_at: title === "Gone" ? new Date() : null,
          })
          .returning("id")
          .executeTakeFirstOrThrow(),
      ),
    );
    if (item === undefined || broken === undefined) throw new Error("seed");
    const moment = await trx
      .insertInto("moment")
      .values({
        content_item_id: item.id,
        ordinal: 0,
        title: "ch. 6 Partitioning",
        estimated_minutes: 4,
        link: "https://example.test/ddia#6",
        link_type: "anchor",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const concept = await trx
      .insertInto("concept")
      .values({
        slug: `c-${randomUUID()}`,
        name: "Sharding",
        topic: "databases",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const asked = await asks.submit(me, ask("k"));
    if (typeof asked === "string") throw new Error(asked);
    expect((await asks.get(asked.id, me))?.answer).toBeNull();
    await trx
      .insertInto("ask_answer")
      .values({
        question_id: asked.id,
        outcome: "answered",
        text: "Shard late [m1].",
        citations: JSON.stringify([
          { passage: "m1", item_id: item.id, moment_id: moment.id },
          { passage: "i2", item_id: broken.id },
          { passage: "c3", concept_id: concept.id },
        ]),
        model: "test/model",
        prompt_version: 1,
        cost_usd: "0.0001",
      })
      .execute();
    expect((await asks.latest(me))?.answer).toEqual({
      outcome: "answered",
      text: "Shard late [m1].",
      citations: [
        {
          kind: "reading",
          passage: "m1",
          itemId: item.id,
          momentId: moment.id,
          label: "DDIA · ch. 6 Partitioning",
          topic: "distributed-systems",
        },
        {
          kind: "explainer",
          passage: "c3",
          label: "Explainer · Sharding",
          topic: "databases",
        },
      ],
    });
    // Answered: dropping it (a failed enqueue) never removes it.
    await asks.drop(asked.id);
    expect(await asks.get(asked.id, me)).not.toBeNull();
    expect(await asks.remove(asked.id, await user(trx))).toBe(false);
    expect(await asks.remove(asked.id, me)).toBe(true);
    expect(await asks.get(asked.id, me)).toBeNull();
  });
});

test("spend today: the user's own and the global offline spend, unmetered providers left out", async () => {
  await inRollback(async (trx) => {
    const asks = kyselyAsks(trx);
    const me = await user(trx);
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const before = await asks.spentToday(me, day);
    const usage = (
      userId: string | null,
      provider: "openrouter" | "voyage",
      cost: string,
    ) => ({
      user_id: userId,
      is_offline: userId === null,
      feature: "ask" as const,
      provider,
      model: "m",
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: cost,
    });
    await trx
      .insertInto("ai_usage")
      .values([
        usage(me, "openrouter", "0.02"),
        usage(me, "voyage", "1.00"),
        usage(null, "openrouter", "0.05"),
      ])
      .execute();
    const after = await asks.spentToday(me, day);
    expect(after.userUsd).toBeCloseTo(0.02);
    expect(after.globalUsd - before.globalUsd).toBeCloseTo(0.05);
    expect(after.globalCapCents).toBe(before.globalCapCents);
  });
});

test("the owner's delete takes the answer and the follow-ups with it", async () => {
  await inRollback(async (trx) => {
    const asks = kyselyAsks(trx);
    const me = await user(trx);
    const root = await asks.submit(me, ask("root"));
    if (typeof root === "string") throw new Error(root);
    const child = await asks.submit(me, ask("child", root.id));
    if (typeof child === "string") throw new Error(child);
    await trx
      .insertInto("ask_answer")
      .values({ question_id: root.id, outcome: "nothing_found" })
      .execute();
    expect(await asks.existing(me, "child")).toBe(child.id);
    expect(await asks.remove(root.id, me)).toBe(true);
    expect(await asks.get(child.id, me)).toBeNull();
    expect(await asks.existing(me, "child")).toBeNull();
    const answers = await trx
      .selectFrom("ask_answer")
      .select("question_id")
      .where("question_id", "=", root.id)
      .execute();
    expect(answers).toEqual([]);
  });
});

// Owner, 2026-11-26: deleting a question doesn't give its daily count back.
test("ask, delete, ask: today's count still includes the deleted questions", async () => {
  await inRollback(async (trx) => {
    const asks = kyselyAsks(trx);
    const me = await user(trx);
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 20; i++) {
      const asked = await asks.submit(me, ask(`k${String(i)}`));
      if (typeof asked === "string") throw new Error(asked);
      // The worker's embedding of the question (feature ask, no output tokens),
      // and for some an answer's model call, which doesn't count again.
      await trx
        .insertInto("ai_usage")
        .values([
          {
            user_id: me,
            is_offline: false,
            feature: "ask",
            provider: "voyage",
            model: "e",
            input_tokens: 5,
            output_tokens: 0,
            cost_usd: "0",
          },
          ...(i % 2 === 0
            ? [
                {
                  user_id: me,
                  is_offline: false,
                  feature: "ask" as const,
                  provider: "openrouter" as const,
                  model: "m",
                  input_tokens: 500,
                  output_tokens: 80,
                  cost_usd: "0.0001",
                },
              ]
            : []),
        ])
        .execute();
      await asks.remove(asked.id, me);
    }
    expect(await asks.askedSince(me, day)).toBe(20);
    // One still queued (not embedded yet) counts too.
    await asks.submit(me, ask("queued"));
    expect(await asks.askedSince(me, day)).toBe(20);
  });
});

test("a session's moments: only the owner's answered question, only openable cited moments", async () => {
  await inRollback(async (trx) => {
    const asks = kyselyAsks(trx);
    const me = await user(trx);
    const seed = async (rights: "full_text_internal" | "metadata_only") => {
      const source = await trx
        .insertInto("source")
        .values({
          name: `s-${randomUUID()}`,
          feed_url: `https://${randomUUID()}.example.test/feed.xml`,
          rights_profile: rights,
          moments_seeded: rights !== "metadata_only",
          moments_enabled: rights !== "metadata_only",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const item = await trx
        .insertInto("content_item")
        .values({
          source_id: source.id,
          guid: randomUUID(),
          canonical_url: `https://example.test/${randomUUID()}`,
          title: "Item",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return { source: source.id, item: item.id };
    };
    const shown = await seed("full_text_internal");
    const [a, b] = await Promise.all(
      [3, 2].map((minutes, ordinal) =>
        trx
          .insertInto("moment")
          .values({
            content_item_id: shown.item,
            ordinal,
            title: `Section ${String(ordinal)}`,
            estimated_minutes: minutes,
            link: `https://example.test/${randomUUID()}#s`,
            link_type: "anchor",
          })
          .returning("id")
          .executeTakeFirstOrThrow(),
      ),
    );
    if (a === undefined || b === undefined) throw new Error("seed");
    const concepts = await Promise.all(
      ["Replication", "Sharding"].map((name) =>
        trx
          .insertInto("concept")
          .values({ slug: `c-${randomUUID()}`, name, topic: "databases" })
          .returning("id")
          .executeTakeFirstOrThrow(),
      ),
    );
    const [repl, shard] = concepts.map((c) => c.id);
    if (repl === undefined || shard === undefined) throw new Error("seed");
    for (const [momentId, conceptId] of [
      [a.id, shard],
      [b.id, repl],
    ] as const) {
      await trx
        .insertInto("moment_tagging")
        .values({ moment_id: momentId, difficulty: "beginner" })
        .execute();
      await trx
        .insertInto("moment_concept")
        .values({ moment_id: momentId, concept_id: conceptId })
        .execute();
    }
    await trx
      .insertInto("concept_edge")
      .values({ from_id: repl, to_id: shard, type: "prerequisite_of" })
      .execute();
    const asked = await asks.submit(me, ask("s"));
    if (typeof asked === "string") throw new Error(asked);
    expect(await asks.sessionMoments(asked.id, me)).toBeNull();
    const hiddenSource = await seed("full_text_internal");
    const hiddenMoment = await trx
      .insertInto("moment")
      .values({
        content_item_id: hiddenSource.item,
        ordinal: 0,
        title: "Hidden",
        estimated_minutes: 1,
        link: "https://example.test/h#s",
        link_type: "anchor",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("user_hidden_source")
      .values({ user_id: me, source_id: hiddenSource.source })
      .execute();
    await trx
      .insertInto("ask_answer")
      .values({
        question_id: asked.id,
        outcome: "answered",
        text: "x [m1]",
        citations: JSON.stringify([
          { passage: `m${a.id}`, item_id: shown.item, moment_id: a.id },
          { passage: "i9", item_id: shown.item },
          {
            passage: `m${hiddenMoment.id}`,
            item_id: hiddenSource.item,
            moment_id: hiddenMoment.id,
          },
          { passage: `m${b.id}`, item_id: shown.item, moment_id: b.id },
        ]),
      })
      .execute();
    expect(await asks.sessionMoments(asked.id, await user(trx))).toBeNull();
    expect(await asks.sessionMoments(asked.id, me)).toEqual({
      moments: [
        {
          itemId: shown.item,
          momentId: a.id,
          title: "Section 0",
          sourceName: expect.any(String) as string,
          minutes: 3,
          conceptIds: [shard],
        },
        {
          itemId: shown.item,
          momentId: b.id,
          title: "Section 1",
          sourceName: expect.any(String) as string,
          minutes: 2,
          conceptIds: [repl],
        },
      ],
      prerequisites: [[repl, shard]],
    });
  });
});
