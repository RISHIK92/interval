import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminExplainers } from "./kysely-admin-explainers";

// P4-W22-S01 (§5G, Q-P4-11): the owner's review of explainer scripts: pending ones with
// their cited sections, each decided once.
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
      moment: string;
      second: string;
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
      const second = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 1,
          title: "Terms",
          estimated_minutes: 3,
          link: `https://${tag}.test/raft#terms`,
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const explainer = await trx
        .insertInto("concept_explainer")
        .values({
          concept_id: concept.id,
          script: "Consensus keeps replicas agreeing.",
          // A section re-segmented away is left out.
          citations: JSON.stringify([
            { moment_id: Number(moment.id), quote: "a quote" },
            { moment_id: Number(second.id), quote: "another" },
            { moment_id: 999999999999, quote: "gone" },
          ]),
          generator_model: "qwen/x",
          prompt_version: 1,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await body(trx, {
        admin,
        explainer: explainer.id,
        moment: moment.id,
        second: second.id,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("pending scripts with their cited sections; each decided once", async () => {
  await inRollback(async (trx, { admin, explainer, moment, second }) => {
    const store = kyselyAdminExplainers(trx);
    const mine = (await store.pending()).find((x) => x.id === explainer);
    expect(mine).toMatchObject({
      concept: "Consensus",
      missing: 1,
      script: "Consensus keeps replicas agreeing.",
      model: "qwen/x",
      citations: [
        {
          momentId: moment,
          articleTitle: "Raft",
          sectionTitle: "Elections",
          link: expect.stringMatching(/#elections$/) as string,
        },
        { momentId: second, sectionTitle: "Terms" },
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

test("a script left with fewer than two sources can't be approved, only rejected", async () => {
  await inRollback(async (trx, { admin, explainer, second }) => {
    await trx.deleteFrom("moment").where("id", "=", second).execute();
    const store = kyselyAdminExplainers(trx);
    expect(await store.decide(explainer, "approved", admin)).toBe(false);
    expect(await store.decide(explainer, "rejected", admin)).toBe(true);
  });
});
