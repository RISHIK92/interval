import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminExplainers } from "./kysely-admin-explainers";

// P4-W22-S01 (§5G, Q-P4-11): the owner's review of explainer scripts: pending ones with
// their cited articles (ADR-0058), each decided once.
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
  body: (
    trx: Transaction<DB>,
    seeded: {
      admin: string;
      explainer: string;
      raft: string;
      paxos: string;
    },
  ) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `EXPL${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
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
      const tag = randomUUID().slice(0, 8);
      const concept = await trx
        .insertInto("concept")
        .values({
          slug: `x-${tag}`,
          name: "Consensus",
          topic: "distributed-systems",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const source = await trx
        .insertInto("source")
        .values({
          name: `Explainer source ${tag}`,
          feed_url: `https://${tag}.test/feed`,
          rights_profile: "full_text_internal",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const article = async (title: string) =>
        trx
          .insertInto("content_item")
          .values({
            source_id: source.id,
            guid: `${tag}-${title}`,
            canonical_url: `https://${tag}.test/${title.toLowerCase()}`,
            title,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
      const raft = await article("Raft");
      const paxos = await article("Paxos");
      const explainer = await trx
        .insertInto("concept_explainer")
        .values({
          concept_id: concept.id,
          script: "Consensus keeps replicas agreeing.",
          // An article cited twice counts once; one naming no article any more (its
          // article gone before ADR-0058 folded moments into articles) is left out.
          citations: JSON.stringify([
            { content_item_id: Number(raft.id), quote: "a quote" },
            { content_item_id: Number(raft.id), quote: "again" },
            { content_item_id: Number(paxos.id), quote: "another" },
            { quote: "gone" },
          ]),
          generator_model: "qwen/x",
          prompt_version: 1,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await body(trx, {
        admin,
        explainer: explainer.id,
        raft: raft.id,
        paxos: paxos.id,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("pending scripts with their cited articles; each decided once", async () => {
  await inRollback(async (trx, { admin, explainer, raft, paxos }) => {
    const store = kyselyAdminExplainers(trx);
    const mine = (await store.pending()).find((x) => x.id === explainer);
    expect(mine).toMatchObject({
      concept: "Consensus",
      missing: 1,
      script: "Consensus keeps replicas agreeing.",
      model: "qwen/x",
      citations: [
        {
          itemId: raft,
          articleTitle: "Raft",
          link: expect.stringMatching(/\/raft$/) as string,
        },
        { itemId: paxos, articleTitle: "Paxos" },
      ],
    });
    expect(await store.decide(explainer, "approved", admin)).toBe(true);
    expect(await store.decide(explainer, "rejected", admin)).toBe(false);
    expect((await store.pending()).some((x) => x.id === explainer)).toBe(false);
    const row = await trx
      .selectFrom("concept_explainer")
      .select(["status", "decided_by"])
      .where("id", "=", explainer)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "approved", decided_by: admin });
  });
});

test("a script left with fewer than two cited articles can't be approved, only rejected", async () => {
  await inRollback(async (trx, { admin, explainer, paxos }) => {
    // Raft is cited twice, but is one source (AI-1).
    await trx.deleteFrom("content_item").where("id", "=", paxos).execute();
    const store = kyselyAdminExplainers(trx);
    expect(await store.decide(explainer, "approved", admin)).toBe(false);
    expect(await store.decide(explainer, "rejected", admin)).toBe(true);
  });
});
