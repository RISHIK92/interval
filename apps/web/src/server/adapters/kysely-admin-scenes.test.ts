import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminScenes } from "./kysely-admin-scenes";

// P4.5-W26-S02 (AI-1, Q-P4.5-03): drafted scene timelines, pending with their
// explainer's captions, each decided once by the owner.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

const captions = [
  { text: "Raft", start: 0, end: 0.4 },
  { text: "elects.", start: 0.4, end: 1 },
];

async function inRollback(
  body: (
    trx: Transaction<DB>,
    seeded: { admin: string; scene: string; decided: string },
  ) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `SCNE${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
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
      const drawn = async (name: string, status: "pending" | "rejected") => {
        const concept = await trx
          .insertInto("concept")
          .values({
            slug: `s-${randomUUID().slice(0, 8)}`,
            name,
            topic: "distributed-systems",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const explainer = await trx
          .insertInto("concept_explainer")
          .values({
            concept_id: concept.id,
            script: "Raft elects.",
            citations: JSON.stringify([]),
            generator_model: "m",
            prompt_version: 1,
            status: "approved",
            decided_at: sql<Date>`now()`,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("explainer_audio")
          .values({
            explainer_id: explainer.id,
            provider: "polly",
            voice: "v",
            playlist_key: `media/explainers/${concept.id}/${explainer.id}/r/index.m3u8`,
            duration_seconds: "1",
            words: JSON.stringify([]),
            captions: JSON.stringify(captions),
          })
          .execute();
        const scene = await trx
          .insertInto("explainer_scene")
          .values({
            explainer_id: explainer.id,
            scene_key: `media/explainers/${concept.id}/${explainer.id}/scenes/a.json`,
            generator_model: "qwen/x",
            prompt_version: 1,
            status,
            decided_at: status === "pending" ? null : sql<Date>`now()`,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return scene.id;
      };
      const scene = await drawn("Leader election", "pending");
      const decided = await drawn("Log replication", "rejected");
      await body(trx, { admin, scene, decided });
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
}

test("pending timelines come with their key and their explainer's captions", async () => {
  await inRollback(async (trx, { scene, decided }) => {
    const store = kyselyAdminScenes(trx);
    const mine = (await store.pending()).filter(
      (s) => s.id === scene || s.id === decided,
    );
    expect(mine).toEqual([
      expect.objectContaining({
        id: scene,
        concept: "Leader election",
        model: "qwen/x",
        captions,
      }),
    ]);
    expect(mine[0]?.key).toMatch(
      /^media\/explainers\/\d+\/\d+\/scenes\/a\.json$/,
    );
    expect(await store.scene(scene)).toEqual(mine[0]);
    expect(await store.scene(decided)).toBeNull();
  });
});

test("a timeline is decided once, by whom and when", async () => {
  await inRollback(async (trx, { admin, scene }) => {
    const store = kyselyAdminScenes(trx);
    expect(await store.decide(scene, "approved", admin)).toBe(true);
    expect(await store.decide(scene, "rejected", admin)).toBe(false);
    const row = await trx
      .selectFrom("explainer_scene")
      .select(["status", "decided_by", "decided_at"])
      .where("id", "=", scene)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("approved");
    expect(row.decided_by).toBe(admin);
    expect(row.decided_at).toBeInstanceOf(Date);
    expect(await store.scene(scene)).toBeNull();
  });
});

test("a rejection is recorded by whom and when, too", async () => {
  await inRollback(async (trx, { admin, scene }) => {
    expect(await kyselyAdminScenes(trx).decide(scene, "rejected", admin)).toBe(
      true,
    );
    const row = await trx
      .selectFrom("explainer_scene")
      .select(["status", "decided_by", "decided_at"])
      .where("id", "=", scene)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("rejected");
    expect(row.decided_by).toBe(admin);
    expect(row.decided_at).toBeInstanceOf(Date);
  });
});
