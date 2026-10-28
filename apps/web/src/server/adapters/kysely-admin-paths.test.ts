import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminPaths } from "./kysely-admin-paths";

// The owner's review of proposed topic paths (§5F, Q-P2-23, P2-W10-S02).
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
  pathId: string;
  sections: string[];
  sourceId: string;
  otherSource: string;
};

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const sources = await trx
        .insertInto("source")
        .values(
          [1, 2].map((n) => ({
            name: `paths-${String(n)}-${randomUUID()}`,
            feed_url: `https://paths.example.test/${randomUUID()}.xml`,
            rights_profile: "full_text_internal" as const,
            moments_seeded: true,
            moments_enabled: true,
          })),
        )
        .returning("id")
        .execute();
      const [one, two] = sources;
      if (!one || !two) throw new Error("seed");
      const items = await trx
        .insertInto("content_item")
        .values(
          [one, two].map((s, n) => ({
            source_id: s.id,
            guid: randomUUID(),
            canonical_url: `https://paths.example.test/${String(n)}`,
            title: `Article ${String(n + 1)}`,
          })),
        )
        .returning("id")
        .execute();
      const moments = await trx
        .insertInto("moment")
        .values(
          items.flatMap((item, n) =>
            ["A", "B"].map((title, ordinal) => ({
              content_item_id: item.id,
              ordinal,
              title: `${title}${String(n + 1)}`,
              estimated_minutes: 3,
              link: `https://paths.example.test/${String(n)}#${title}`,
              link_type: "anchor" as const,
            })),
          ),
        )
        .returning("id")
        .execute();
      const concepts = await trx
        .insertInto("concept")
        .values(
          ["Replication", "Lag", "Quorum"].map((name) => ({
            slug: `${name.toLowerCase()}-${randomUUID()}`,
            name,
            topic: "distributed-systems",
          })),
        )
        .returning("id")
        .execute();
      const path = await trx
        .insertInto("path")
        .values({
          name: "Replication basics",
          why: "Why replicas fall behind.",
          model: "m",
          prompt_version: 1,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const sections: string[] = [];
      for (const [ordinal, moment] of [
        [0, [moments[0], moments[2]]],
        [1, [moments[1]]],
        [2, [moments[3]]],
      ] as const) {
        const section = await trx
          .insertInto("path_section")
          .values({ path_id: path.id, ordinal })
          .returning("id")
          .executeTakeFirstOrThrow();
        sections.push(section.id);
        const concept = concepts[ordinal];
        if (concept === undefined) throw new Error("seed");
        await trx
          .insertInto("path_section_concept")
          .values({ section_id: section.id, concept_id: concept.id })
          .execute();
        await trx
          .insertInto("path_session")
          .values(
            moment.map((m, i) => {
              if (m === undefined) throw new Error("seed");
              return { section_id: section.id, ordinal: i, moment_id: m.id };
            }),
          )
          .execute();
      }
      await body(trx, {
        pathId: path.id,
        sections,
        sourceId: one.id,
        otherSource: two.id,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

async function ours(trx: Transaction<DB>, pathId: string) {
  const found = (await kyselyAdminPaths(trx).list()).find(
    (p) => p.pathId === pathId,
  );
  if (found === undefined) throw new Error("not listed");
  return found;
}

test("a draft lists its sections and readings in order", async () => {
  await inRollback(async (trx, { pathId }) => {
    const path = await ours(trx, pathId);
    expect(path).toMatchObject({
      name: "Replication basics",
      why: "Why replicas fall behind.",
      status: "draft",
    });
    expect(path.sections.map((s) => s.concepts)).toEqual([
      ["Replication"],
      ["Lag"],
      ["Quorum"],
    ]);
    expect(path.sections[0]?.sessions.map((s) => s.sectionTitle)).toEqual([
      "A1",
      "A2",
    ]);
    expect(path.sections[0]?.sessions[0]).toMatchObject({
      articleTitle: "Article 1",
      link: "https://paths.example.test/0#A",
      allowed: true,
    });
  });
});

test("a reading whose source lost its rights is flagged and blocks approval", async () => {
  await inRollback(async (trx, { pathId, otherSource, sections }) => {
    // Moments stay when a source's rights drop (only a switch-off purges them), so
    // a lowered rights profile is the case to flag.
    await sql`set local session_replication_role = replica`.execute(trx);
    await trx
      .updateTable("source")
      .set({ rights_profile: "metadata_only" })
      .where("id", "=", otherSource)
      .execute();
    await sql`set local session_replication_role = origin`.execute(trx);
    const path = await ours(trx, pathId);
    expect(path.sections[0]?.sessions.map((s) => s.allowed)).toEqual([
      true,
      false,
    ]);
    // The last section's only reading is from that source: nothing allowed to read.
    expect(path.sections[2]?.sessions.map((s) => s.allowed)).toEqual([false]);
    const admin = kyselyAdminPaths(trx);
    expect(await admin.approve(pathId)).toBe(false);
    expect(await admin.removeSection(sections[2] ?? "")).toBe(true);
    expect(await admin.approve(pathId)).toBe(true);
  });
});

test("sections move up and down, and stop at either end", async () => {
  await inRollback(async (trx, { pathId, sections }) => {
    const admin = kyselyAdminPaths(trx);
    const [first, second, third] = sections;
    if (!first || !second || !third) throw new Error("seed");
    expect(await admin.moveSection(third, "up")).toBe(true);
    expect((await ours(trx, pathId)).sections.map((s) => s.sectionId)).toEqual([
      first,
      third,
      second,
    ]);
    expect(await admin.moveSection(first, "up")).toBe(false);
    expect(await admin.moveSection(second, "down")).toBe(false);
    expect(await admin.moveSection(first, "down")).toBe(true);
    expect((await ours(trx, pathId)).sections.map((s) => s.sectionId)).toEqual([
      third,
      first,
      second,
    ]);
  });
});

test("readings and sections can be removed, and the name and why edited", async () => {
  await inRollback(async (trx, { pathId, sections }) => {
    const admin = kyselyAdminPaths(trx);
    const [first, second] = sections;
    if (!first || !second) throw new Error("seed");
    expect(await admin.removeSession(first, 1)).toBe(true);
    expect(await admin.removeSession(first, 1)).toBe(false);
    expect(await admin.removeSection(second)).toBe(true);
    expect(
      await admin.rename(pathId, "Replicas", "How copies stay close."),
    ).toBe(true);
    const path = await ours(trx, pathId);
    expect(path.name).toBe("Replicas");
    expect(path.why).toBe("How copies stay close.");
    expect(path.sections.map((s) => s.sessions.length)).toEqual([1, 1]);
  });
});

test("a path needs two sections to go live, and a live path isn't edited", async () => {
  await inRollback(async (trx, { pathId, sections }) => {
    const admin = kyselyAdminPaths(trx);
    const [first, second, third] = sections;
    if (!first || !second || !third) throw new Error("seed");
    await admin.removeSection(second);
    await admin.removeSection(third);
    expect(await admin.approve(pathId)).toBe(false);
    expect((await ours(trx, pathId)).status).toBe("draft");
    const fresh = await trx
      .selectFrom("path_section")
      .select("id")
      .where("path_id", "=", pathId)
      .execute();
    expect(fresh).toHaveLength(1);
  });
  await inRollback(async (trx, { pathId, sections }) => {
    const admin = kyselyAdminPaths(trx);
    const [first] = sections;
    if (!first) throw new Error("seed");
    expect(await admin.approve(pathId)).toBe(true);
    expect((await ours(trx, pathId)).status).toBe("live");
    expect(await admin.approve(pathId)).toBe(false);
    // Live: no edits, only retiring.
    expect(await admin.rename(pathId, "X", "Y")).toBe(false);
    expect(await admin.moveSection(first, "down")).toBe(false);
    expect(await admin.removeSection(first)).toBe(false);
    expect(await admin.removeSession(first, 0)).toBe(false);
    expect(await admin.retire(pathId)).toBe(true);
    expect((await ours(trx, pathId)).status).toBe("retired");
    expect(await admin.retire(pathId)).toBe(false);
  });
});

test("drafts come before live paths, and live before retired", async () => {
  await inRollback(async (trx, { pathId }) => {
    const [live, retired] = await trx
      .insertInto("path")
      .values(
        (["live", "retired"] as const).map((status) => ({
          name: `${status} one`,
          why: "w",
          model: "m",
          prompt_version: 1,
          status,
        })),
      )
      .returning("id")
      .execute();
    if (!live || !retired) throw new Error("seed");
    const listed = (await kyselyAdminPaths(trx).list()).map((p) => p.pathId);
    expect(listed.indexOf(pathId)).toBeLessThan(listed.indexOf(live.id));
    expect(listed.indexOf(live.id)).toBeLessThan(listed.indexOf(retired.id));
  });
});

test("a draft can be retired without going live", async () => {
  await inRollback(async (trx, { pathId }) => {
    expect(await kyselyAdminPaths(trx).retire(pathId)).toBe(true);
    expect((await ours(trx, pathId)).status).toBe("retired");
  });
});

test("a reading from a duplicate article isn't allowed", async () => {
  await inRollback(async (trx, { pathId }) => {
    const path = await ours(trx, pathId);
    const reading = path.sections[2]?.sessions[0];
    if (reading === undefined) throw new Error("seed");
    const item = await trx
      .selectFrom("moment")
      .select("content_item_id")
      .where("id", "=", reading.momentId)
      .executeTakeFirstOrThrow();
    const original = await trx
      .selectFrom("content_item")
      .select("id")
      .where("id", "!=", item.content_item_id)
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("content_item")
      .set({ duplicate_of: original.id })
      .where("id", "=", item.content_item_id)
      .execute();
    const after = await ours(trx, pathId);
    expect(after.sections[2]?.sessions[0]?.allowed).toBe(false);
    expect(await kyselyAdminPaths(trx).approve(pathId)).toBe(false);
  });
});

test("retiring a live path pauses everyone following it (owner, 2026-10-28)", async () => {
  await inRollback(async (trx, { pathId }) => {
    const admin = kyselyAdminPaths(trx);
    expect(await admin.approve(pathId)).toBe(true);
    const code = await trx
      .insertInto("invite_code")
      .values({
        code: `RETIRE${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
        beta_group: "student",
        max_uses: 1,
        expires_at: sql<Date>`now() + interval '1 day'`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const follower = randomUUID();
    await trx
      .insertInto("app_user")
      .values({
        id: follower,
        name: "n",
        email: `${follower}@example.test`,
        beta_group: "student",
        invite_code_id: code.id,
      })
      .execute();
    await trx
      .insertInto("user_path")
      .values({ user_id: follower, path_id: pathId, status: "active" })
      .execute();
    expect(await admin.retire(pathId)).toBe(true);
    const row = await trx
      .selectFrom("user_path")
      .select("status")
      .where("user_id", "=", follower)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("paused");
  });
});
