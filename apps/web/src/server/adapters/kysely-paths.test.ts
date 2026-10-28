import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyPaths } from "./kysely-paths";

// Following topic paths (§5F, Q-P2-27, P2-W10-S03).
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
  live: string;
  other: string;
  draft: string;
  moments: string[];
  otherSource: string;
};

async function makePath(
  trx: Transaction<DB>,
  name: string,
  status: "draft" | "live" | "retired",
  sections: string[][],
): Promise<string> {
  const path = await trx
    .insertInto("path")
    .values({
      name,
      why: `${name}, why.`,
      model: "m",
      prompt_version: 1,
      status,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const [ordinal, moments] of sections.entries()) {
    const section = await trx
      .insertInto("path_section")
      .values({ path_id: path.id, ordinal: ordinal * 10 })
      .returning("id")
      .executeTakeFirstOrThrow();
    const concept = await trx
      .selectFrom("concept")
      .select("id")
      .where("name", "=", `Concept ${String(ordinal + 1)}`)
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("path_section_concept")
      .values({ section_id: section.id, concept_id: concept.id })
      .execute();
    await trx
      .insertInto("path_session")
      .values(
        moments.map((moment_id, i) => ({
          section_id: section.id,
          ordinal: i,
          moment_id,
        })),
      )
      .execute();
  }
  return path.id;
}

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const sources = await trx
        .insertInto("source")
        .values(
          [1, 2].map((n) => ({
            name: `follow-${String(n)}-${randomUUID()}`,
            feed_url: `https://follow.example.test/${randomUUID()}.xml`,
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
            canonical_url: `https://follow.example.test/${String(n)}`,
            title: `Article ${String(n + 1)}`,
            frameable: n === 0,
          })),
        )
        .returning("id")
        .execute();
      const moments = (
        await trx
          .insertInto("moment")
          .values(
            items.flatMap((item, n) =>
              ["A", "B"].map((title, ordinal) => ({
                content_item_id: item.id,
                ordinal,
                title: `${title}${String(n + 1)}`,
                estimated_minutes: 3 + ordinal,
                link: `https://follow.example.test/${String(n)}#${title}`,
                link_type: "anchor" as const,
              })),
            ),
          )
          .returning("id")
          .execute()
      ).map((m) => m.id);
      await trx
        .insertInto("concept")
        .values(
          [1, 2].map((n) => ({
            slug: `concept-${String(n)}-${randomUUID()}`,
            name: `Concept ${String(n)}`,
            topic: "distributed-systems",
          })),
        )
        .execute();
      const [m1, m2, m3, m4] = moments;
      if (!m1 || !m2 || !m3 || !m4) throw new Error("seed");
      const live = await makePath(trx, "Replication", "live", [
        [m1, m3],
        [m2, m4],
      ]);
      const other = await makePath(trx, "Caching", "live", [[m2], [m4]]);
      const draft = await makePath(trx, "Draft", "draft", [[m1], [m2]]);
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `PATH${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
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
        live,
        other,
        draft,
        moments,
        otherSource: two.id,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("live paths are listed with their size and the user's status", async () => {
  await inRollback(async (trx, { userId, live, other, draft }) => {
    const paths = kyselyPaths(trx);
    const listed = (await paths.live(userId)).filter((p) =>
      [live, other, draft].includes(p.pathId),
    );
    expect(listed.map((p) => p.pathId).sort()).toEqual([live, other].sort());
    const replication = listed.find((p) => p.pathId === live);
    expect(replication).toMatchObject({
      name: "Replication",
      sections: 2,
      readings: 4,
      minutes: 3 + 3 + 4 + 4,
      mine: null,
    });
  });
});

test("starting a path makes it active and pauses the other", async () => {
  await inRollback(async (trx, { userId, live, other, draft }) => {
    const paths = kyselyPaths(trx);
    expect(await paths.start(userId, live)).toBe(true);
    expect(await paths.start(userId, live)).toBe(false);
    expect(await paths.start(userId, other)).toBe(true);
    const mine = Object.fromEntries(
      (await paths.live(userId)).map((p) => [p.pathId, p.mine]),
    );
    expect(mine[live]).toBe("paused");
    expect(mine[other]).toBe("active");
    // Resuming a paused path makes it active again.
    expect(await paths.start(userId, live)).toBe(true);
    expect(await paths.start(userId, draft)).toBeNull();
  });
});

test("the timeline ticks finished readings and opens only the first section", async () => {
  await inRollback(async (trx, { userId, live, moments }) => {
    const [m1] = moments;
    if (!m1) throw new Error("seed");
    await trx
      .insertInto("user_moment_finished")
      .values({ user_id: userId, moment_id: m1, method: "mark_done" })
      .execute();
    const timeline = await kyselyPaths(trx).path(userId, live);
    expect(timeline).toMatchObject({
      name: "Replication",
      retired: false,
      mine: null,
    });
    expect(timeline?.sections.map((s) => s.open)).toEqual([true, false]);
    expect(timeline?.sections[0]?.concepts).toEqual(["Concept 1"]);
    expect(
      timeline?.sections[0]?.readings.map((r) => [r.sectionTitle, r.finished]),
    ).toEqual([
      ["A1", true],
      ["A2", false],
    ]);
    expect(timeline?.sections[0]?.readings[0]).toMatchObject({
      articleTitle: "Article 1",
      minutes: 3,
      frameable: true,
      linkBroken: false,
    });
  });
});

test("readings whose rights changed are left out (ING-2)", async () => {
  await inRollback(async (trx, { userId, live, otherSource }) => {
    await sql`set local session_replication_role = replica`.execute(trx);
    await trx
      .updateTable("source")
      .set({ rights_profile: "metadata_only" })
      .where("id", "=", otherSource)
      .execute();
    await sql`set local session_replication_role = origin`.execute(trx);
    // The list counts what the timeline shows (ING-2): A1 (3 min) and B1 (4 min).
    const listed = (await kyselyPaths(trx).live(userId)).find(
      (p) => p.pathId === live,
    );
    expect(listed).toMatchObject({ readings: 2, minutes: 3 + 4 });
    const timeline = await kyselyPaths(trx).path(userId, live);
    expect(
      timeline?.sections.map((s) => s.readings.map((r) => r.sectionTitle)),
    ).toEqual([["A1"], ["B1"]]);
  });
});

test("a draft isn't readable; a retired path stays, read-only, for those who follow it", async () => {
  await inRollback(async (trx, { userId, live, draft }) => {
    const paths = kyselyPaths(trx);
    expect(await paths.path(userId, draft)).toBeNull();
    await paths.start(userId, live);
    // As the admin's Retire does (owner, 2026-10-28): retired, followers paused.
    await trx
      .updateTable("path")
      .set({ status: "retired" })
      .where("id", "=", live)
      .execute();
    await trx
      .updateTable("user_path")
      .set({ status: "paused" })
      .where("path_id", "=", live)
      .execute();
    expect(await paths.path(userId, live)).toMatchObject({
      retired: true,
      mine: "paused",
    });
    expect(await paths.path("someone-else", live)).toBeNull();
    // In the follower's list, marked retired; not in anyone else's.
    expect(
      (await paths.live(userId)).find((p) => p.pathId === live),
    ).toMatchObject({ retired: true, mine: "paused" });
    expect(
      (await paths.live("someone-else")).some((p) => p.pathId === live),
    ).toBe(false);
    // And it can't be resumed.
    expect(await paths.start(userId, live)).toBeNull();
  });
});
