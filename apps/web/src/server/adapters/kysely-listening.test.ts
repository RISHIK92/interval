import { randomUUID } from "node:crypto";
import { ListenResponse } from "@interval/api-client";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyListening } from "./kysely-listening";

// P4-W23-S01 (§5G, §5I): the audio queue, saved positions and Up next.
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
  user: string;
  item: string;
  moment: string;
  // Explainers by concept: raft and paxos voiced and approved on the section; quorum
  // voiced on the article only; draft approved but not voiced; leases voiced, reached
  // from raft by an edge only.
  x: Record<"raft" | "paxos" | "quorum" | "draft" | "leases", string>;
  c: Record<"raft" | "paxos" | "quorum" | "draft" | "leases", string>;
};

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `LSTN${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 1,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const user = randomUUID();
      await trx
        .insertInto("app_user")
        .values({
          id: user,
          name: "n",
          email: `${user}@example.test`,
          beta_group: "student",
          invite_code_id: code.id,
        })
        .execute();
      const tag = randomUUID().slice(0, 8);
      const source = await trx
        .insertInto("source")
        .values({
          name: `Listen source ${tag}`,
          feed_url: `https://${tag}.test/feed`,
          rights_profile: "full_text_internal",
          moments_enabled: true,
          moments_seeded: true,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const item = await trx
        .insertInto("content_item")
        .values({
          source_id: source.id,
          guid: tag,
          canonical_url: `https://${tag}.test/raft`,
          title: "Raft",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moment = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 0,
          title: "Elections",
          estimated_minutes: 3,
          link: `https://${tag}.test/raft#elections`,
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("moment_tagging")
        .values({ moment_id: moment.id, difficulty: "beginner" })
        .execute();
      const names = ["raft", "paxos", "quorum", "draft", "leases"] as const;
      const c = {} as Seeded["c"];
      const x = {} as Seeded["x"];
      for (const name of names) {
        const concept = await trx
          .insertInto("concept")
          .values({
            slug: `${name}-${tag}`,
            name: `${name[0]?.toUpperCase() ?? ""}${name.slice(1)} ${tag}`,
            topic: "distributed-systems",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        c[name] = concept.id;
        const explainer = await trx
          .insertInto("concept_explainer")
          .values({
            concept_id: concept.id,
            script: `About ${name}.`,
            citations: JSON.stringify([
              { moment_id: Number(moment.id), quote: "q" },
              { moment_id: 999999999999, quote: "gone" },
            ]),
            generator_model: "m",
            prompt_version: 1,
            status: "approved",
            decided_at: new Date(),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        x[name] = explainer.id;
        if (name !== "draft") {
          await trx
            .insertInto("explainer_audio")
            .values({
              explainer_id: explainer.id,
              provider: "polly",
              voice: "v",
              playlist_key: `media/explainers/${concept.id}/${explainer.id}/r/index.m3u8`,
              duration_seconds: 90,
              words: JSON.stringify([]),
              captions: JSON.stringify([]),
            })
            .execute();
        }
      }
      await trx
        .insertInto("moment_concept")
        .values(
          (["raft", "paxos", "draft"] as const).map((n) => ({
            moment_id: moment.id,
            concept_id: c[n],
          })),
        )
        .execute();
      await trx
        .insertInto("item_tagging")
        .values({
          content_item_id: item.id,
          difficulty: "beginner",
          model: "m",
          prompt_version: 1,
        })
        .execute();
      await trx
        .insertInto("item_concept")
        .values({ content_item_id: item.id, concept_id: c.quorum })
        .execute();
      await body(trx, { user, item: item.id, moment: moment.id, x, c });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("voiced: the section's concepts, or the article's; approved with audio only", async () => {
  await inRollback(async (trx, { item, moment, x }) => {
    const store = kyselyListening(trx);
    expect(await store.voiced(item, moment)).toEqual([x.paxos, x.raft]);
    expect(await store.voiced(item, null)).toEqual([x.quorum]);
    // A section of another article names nothing.
    expect(await store.voiced("999999999999", moment)).toEqual([]);
  });
});

test("the queue keeps its order, adds once, and lists sources and positions", async () => {
  await inRollback(async (trx, { user, moment, x, c }) => {
    const store = kyselyListening(trx);
    await store.add(user, [x.raft, x.paxos]);
    await store.add(user, [x.paxos, x.quorum, x.draft]);
    const view = ListenResponse.parse(await store.queue(user));
    expect(view.queue.map((q) => q.explainerId)).toEqual([
      x.raft,
      x.paxos,
      x.quorum,
    ]);
    expect(view.queue[0]).toEqual({
      explainerId: x.raft,
      conceptId: c.raft,
      concept: expect.stringMatching(/^Raft /) as string,
      src: `/media/explainers/${c.raft}/${x.raft}/r/index.m3u8`,
      durationSeconds: 90,
      positionSeconds: 0,
      sources: [
        {
          title: "Elections — Raft",
          href: expect.stringMatching(/#elections$/) as string,
        },
      ],
      captions: [],
    });
    expect(moment).toBeTruthy();
    // Saved only once it's started.
    expect(await store.save(user, x.paxos, 41.5)).toBe(false);
    await store.start(user, x.paxos);
    expect(await store.save(user, x.paxos, 41.5)).toBe(true);
    expect(await store.save(user, x.draft, 3)).toBe(false);
    const saved = await store.queue(user);
    expect(saved.queue[1]?.positionSeconds).toBe(41.5);
    expect(await store.remove(user, x.paxos)).toBe(true);
    expect(await store.remove(user, x.paxos)).toBe(false);
    expect((await store.queue(user)).queue).toHaveLength(2);
  });
});

test("start is new, then a resume, then new again after a finish", async () => {
  await inRollback(async (trx, { user, x, c }) => {
    const store = kyselyListening(trx);
    await store.add(user, [x.raft]);
    expect(await store.start(user, x.raft)).toEqual({
      conceptId: c.raft,
      new: true,
    });
    await store.save(user, x.raft, 30);
    expect(await store.start(user, x.raft)).toEqual({
      conceptId: c.raft,
      new: false,
    });
    expect((await store.queue(user)).queue[0]?.positionSeconds).toBe(30);
    expect(await store.finish(user, x.raft)).toEqual({
      conceptId: c.raft,
      new: true,
    });
    expect((await store.queue(user)).queue).toEqual([]);
    // A retried finish isn't counted again; the browser's end-of-play save is dropped.
    expect(await store.finish(user, x.raft)).toEqual({
      conceptId: c.raft,
      new: false,
    });
    expect(await store.save(user, x.raft, 89)).toBe(false);
    await store.add(user, [x.raft]);
    expect((await store.queue(user)).queue[0]?.positionSeconds).toBe(0);
    expect(await store.start(user, x.raft)).toEqual({
      conceptId: c.raft,
      new: true,
    });
    expect(await store.start(user, x.draft)).toBeNull();
    expect(await store.finish(user, x.draft)).toBeNull();
  });
});

test("Up next follows an edge from the last finished, prerequisite first, skipping queued and finished", async () => {
  await inRollback(async (trx, { user, x, c }) => {
    const store = kyselyListening(trx);
    expect((await store.queue(user)).upNext).toBeNull();
    await trx
      .insertInto("concept_edge")
      .values([
        // paxos relates to raft (incoming); raft is a prerequisite of leases.
        { from_id: c.paxos, to_id: c.raft, type: "related_to" },
        { from_id: c.raft, to_id: c.leases, type: "prerequisite_of" },
        // draft has no audio, so it's never offered.
        { from_id: c.raft, to_id: c.draft, type: "prerequisite_of" },
      ])
      .execute();
    await store.finish(user, x.raft);
    expect((await store.queue(user)).upNext?.explainerId).toBe(x.leases);
    await store.add(user, [x.leases]);
    expect((await store.queue(user)).upNext?.explainerId).toBe(x.paxos);
    await store.finish(user, x.paxos);
    await store.finish(user, x.raft);
    // leases is still queued, paxos finished: nothing left to offer.
    expect((await store.queue(user)).upNext).toBeNull();
  });
});

// P4-W23-S03 (TTS-3): the worker's captions come with the queue.
test("captions as the worker stored them", async () => {
  await inRollback(async (trx, { user, x }) => {
    const stored = [
      { text: "Use", start: 0, end: 0.3 },
      { text: "PostgreSQL.", start: 0.4, end: 1 },
    ];
    await trx
      .updateTable("explainer_audio")
      .set({ captions: JSON.stringify(stored) })
      .where("explainer_id", "=", x.raft)
      .execute();
    const store = kyselyListening(trx);
    await store.add(user, [x.raft]);
    expect((await store.queue(user)).queue[0]?.captions).toEqual(stored);
  });
});
