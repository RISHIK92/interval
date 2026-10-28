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
    expect(await paths.start(userId, live)).toEqual({
      firstTime: true,
      paused: null,
    });
    expect(await paths.start(userId, live)).toEqual({
      firstTime: false,
      paused: null,
    });
    // It reports the path it paused (the continuity metric counts it, Q-P2-28).
    expect(await paths.start(userId, other)).toEqual({
      firstTime: true,
      paused: live,
    });
    const mine = Object.fromEntries(
      (await paths.live(userId)).map((p) => [p.pathId, p.mine]),
    );
    expect(mine[live]).toBe("paused");
    expect(mine[other]).toBe("active");
    // Resuming a paused path makes it active again.
    expect(await paths.start(userId, live)).toMatchObject({ firstTime: true });
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

// P2-W10-S05 (C-25, Q-P2-23): edits to the user's own copy; the approved path never
// changes.
async function sectionsOf(
  trx: Transaction<DB>,
  userId: string,
  pathId: string,
): Promise<[string, string]> {
  const timeline = await kyselyPaths(trx).path(userId, pathId);
  const [one, two] = timeline?.sections ?? [];
  if (!one || !two) throw new Error("seed");
  return [one.sectionId, two.sectionId];
}

test("pause pauses the active path once", async () => {
  await inRollback(async (trx, { userId, live }) => {
    const paths = kyselyPaths(trx);
    expect(await paths.pause(userId, live)).toBe(false);
    await paths.start(userId, live);
    expect(await paths.pause(userId, live)).toBe(true);
    expect(await paths.pause(userId, live)).toBe(false);
    expect((await paths.path(userId, live))?.mine).toBe("paused");
  });
});

test("moving a section reorders the user's copy, flags it, and leaves the approved path", async () => {
  await inRollback(async (trx, { userId, live }) => {
    const paths = kyselyPaths(trx);
    const [one, two] = await sectionsOf(trx, userId, live);
    // Not on a path the user doesn't follow.
    expect(await paths.moveSection(userId, two, "up")).toBeNull();
    await paths.start(userId, live);
    expect(await paths.moveSection(userId, one, "up")).toBeNull();
    expect(await paths.moveSection(userId, two, "up")).toBe(live);
    // The deferred place constraint holds at what would be the commit.
    await sql`set constraints all immediate`.execute(trx);
    await sql`set constraints all deferred`.execute(trx);
    const timeline = await paths.path(userId, live);
    expect(timeline?.sections.map((s) => [s.concepts, s.warning])).toEqual([
      [["Concept 2"], ["Concept 1"]],
      [["Concept 1"], null],
    ]);
    // First now, so open; the one moved down waits for it.
    expect(timeline?.sections.map((s) => s.open)).toEqual([true, false]);
    expect(
      (
        await trx
          .selectFrom("path_section")
          .select(["id", "ordinal"])
          .where("path_id", "=", live)
          .orderBy("ordinal")
          .execute()
      ).map((r) => r.id),
    ).toEqual([one, two]);
    // And back, which is in order again.
    expect(await paths.moveSection(userId, two, "down")).toBe(live);
    expect(
      (await paths.path(userId, live))?.sections.map((s) => s.warning),
    ).toEqual([null, null]);
    // Someone else's view of the path is the approved one.
    expect(await paths.moveSection("someone-else", two, "up")).toBeNull();
  });
});

test("a skip opens the next section with no credit; an unskip brings its checkpoint back", async () => {
  await inRollback(async (trx, { userId, live }) => {
    const paths = kyselyPaths(trx);
    const [one, two] = await sectionsOf(trx, userId, live);
    await paths.start(userId, live);
    expect(await paths.skipSection(userId, one)).toBe(live);
    expect(await paths.skipSection(userId, one)).toBeNull();
    let timeline = await paths.path(userId, live);
    expect(
      timeline?.sections.map((s) => [s.skipped, s.open, s.checkpoint]),
    ).toEqual([
      [true, true, "skipped"],
      [false, true, "reading"],
    ]);
    expect(
      await trx
        .selectFrom("concept_mastery")
        .select("concept_id")
        .where("user_id", "=", userId)
        .execute(),
    ).toEqual([]);
    expect(await paths.unskipSection(userId, one)).toBe(live);
    expect(await paths.unskipSection(userId, one)).toBeNull();
    timeline = await paths.path(userId, live);
    // The checkpoint is back; the next section stays open (owner, 2026-10-28).
    expect(
      timeline?.sections.map((s) => [s.skipped, s.open, s.checkpoint]),
    ).toEqual([
      [false, true, "reading"],
      [false, true, "reading"],
    ]);
    expect(await paths.skipSection(userId, one)).toBe(live);
    expect(await paths.unskipSection(userId, two)).toBeNull();
  });
});

test("a session swaps for another moment on its concepts, and falls back when that goes", async () => {
  await inRollback(async (trx, { userId, live, moments }) => {
    const paths = kyselyPaths(trx);
    const [one] = await sectionsOf(trx, userId, live);
    const [m1, , m3] = moments;
    if (!m1 || !m3) throw new Error("seed");
    await paths.start(userId, live);
    const source = await trx
      .selectFrom("content_item")
      .innerJoin("moment", "moment.content_item_id", "content_item.id")
      .select("content_item.source_id")
      .where("moment.id", "=", m1)
      .executeTakeFirstOrThrow();
    const concepts = await trx
      .selectFrom("path_section_concept as pc")
      .innerJoin("path_section as s", "s.id", "pc.section_id")
      .select(["pc.concept_id", "s.ordinal"])
      .where("s.path_id", "=", live)
      .orderBy("s.ordinal")
      .execute();
    const [c1, c2] = concepts.map((c) => c.concept_id);
    if (!c1 || !c2) throw new Error("seed");
    // On Concept 1, on Concept 2, and on Concept 1 behind a broken link.
    const made: string[] = [];
    for (const [n, concept, broken] of [
      [0, c1, false],
      [1, c2, false],
      [2, c1, true],
    ] as const) {
      const item = await trx
        .insertInto("content_item")
        .values({
          source_id: source.source_id,
          guid: randomUUID(),
          canonical_url: `https://follow.example.test/swap-${String(n)}`,
          title: `Swap ${String(n)}`,
          link_broken_at: broken ? sql<Date>`now()` : null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moment = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 0,
          title: `S${String(n)}`,
          estimated_minutes: 5,
          link: `https://follow.example.test/swap-${String(n)}#a`,
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("moment_tagging")
        .values({ moment_id: moment.id, difficulty: "beginner" })
        .execute();
      await trx
        .insertInto("moment_concept")
        .values({ moment_id: moment.id, concept_id: concept })
        .execute();
      made.push(moment.id);
    }
    const [onC1, onC2] = made;
    if (!onC1 || !onC2) throw new Error("seed");
    // The approved session's own moment is on Concept 1 too.
    await trx
      .insertInto("moment_tagging")
      .values({ moment_id: m1, difficulty: "beginner" })
      .execute();
    await trx
      .insertInto("moment_concept")
      .values({ moment_id: m1, concept_id: c1 })
      .execute();
    const offered = await paths.alternatives(userId, one, 0);
    expect(offered.map((o) => o.momentId)).toEqual([onC1]);
    expect(offered[0]).toMatchObject({
      sectionTitle: "S0",
      articleTitle: "Swap 0",
      minutes: 5,
    });
    expect(await paths.swapSession(userId, one, 0, onC2)).toBeNull();
    expect(await paths.swapSession(userId, one, 0, onC1)).toBe(live);
    const titles = async () =>
      (await paths.path(userId, live))?.sections[0]?.readings.map((r) => [
        r.ordinal,
        r.sectionTitle,
      ]);
    expect(await titles()).toEqual([
      [0, "S0"],
      [1, "A2"],
    ]);
    // The approved moment is offered first, untagged or not, to swap back.
    await trx
      .deleteFrom("moment_concept")
      .where("moment_id", "=", m1)
      .execute();
    expect((await paths.alternatives(userId, one, 0))[0]?.momentId).toBe(m1);
    expect(await paths.swapSession(userId, one, 0, m1)).toBe(live);
    expect(
      await trx
        .selectFrom("user_path_session")
        .select("moment_id")
        .where("user_id", "=", userId)
        .execute(),
    ).toEqual([]);
    expect(await titles()).toEqual([
      [0, "A1"],
      [1, "A2"],
    ]);
    // Its rights lowered, a swapped moment gives way to the approved one (ING-2),
    // and comes back with them.
    expect(await paths.swapSession(userId, one, 0, onC1)).toBe(live);
    const own = await trx
      .insertInto("source")
      .values({
        name: `follow-swap-${randomUUID()}`,
        feed_url: `https://follow.example.test/${randomUUID()}.xml`,
        rights_profile: "full_text_internal",
        moments_seeded: true,
        moments_enabled: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("content_item")
      .set({ source_id: own.id })
      .where("title", "=", "Swap 0")
      .execute();
    const rights = async (to: "metadata_only" | "full_text_internal") => {
      await sql`set local session_replication_role = replica`.execute(trx);
      await trx
        .updateTable("source")
        .set({ rights_profile: to })
        .where("id", "=", own.id)
        .execute();
      await sql`set local session_replication_role = origin`.execute(trx);
    };
    await rights("metadata_only");
    expect(await titles()).toEqual([
      [0, "A1"],
      [1, "A2"],
    ]);
    await rights("full_text_internal");
    expect(await titles()).toEqual([
      [0, "S0"],
      [1, "A2"],
    ]);
    // A finished reading isn't swapped.
    await trx
      .insertInto("user_moment_finished")
      .values({ user_id: userId, moment_id: m3, method: "mark_done" })
      .execute();
    expect(await paths.alternatives(userId, one, 1)).toEqual([]);
    // Its moment deleted (a re-split), the session is the approved one again.
    await trx.deleteFrom("moment").where("id", "=", onC1).execute();
    expect(await titles()).toEqual([
      [0, "A1"],
      [1, "A2"],
    ]);
  });
});

// P2-W10-S06 (REC-1, Q-P2-27): the active path's next step, for the feed.
test("next is the first unfinished reading of the active path, then its checkpoint", async () => {
  await inRollback(async (trx, { userId, live, moments }) => {
    const paths = kyselyPaths(trx);
    const [one] = await sectionsOf(trx, userId, live);
    const [m1, , m3] = moments;
    if (!m1 || !m3) throw new Error("seed");
    expect(await paths.next(userId)).toBeNull();
    await paths.start(userId, live);
    expect(await paths.next(userId)).toMatchObject({
      kind: "reading",
      pathId: live,
      pathName: "Replication",
      concepts: ["Concept 1"],
      reading: { momentId: m1 },
      n: 1,
      of: 2,
    });
    await trx
      .insertInto("user_moment_finished")
      .values({ user_id: userId, moment_id: m1, method: "mark_done" })
      .execute();
    expect(await paths.next(userId)).toMatchObject({
      reading: { momentId: m3 },
      n: 2,
    });
    // Readings done but no live question: no checkpoint to offer, so nothing.
    await trx
      .insertInto("user_moment_finished")
      .values({ user_id: userId, moment_id: m3, method: "mark_done" })
      .execute();
    expect(await paths.next(userId)).toBeNull();
    // Skipped, the next section's first reading is next.
    await paths.skipSection(userId, one);
    expect(await paths.next(userId)).toMatchObject({
      kind: "reading",
      concepts: ["Concept 2"],
      reading: { sectionTitle: "B1" },
      n: 1,
    });
    // A paused path has no next step in the feed.
    await paths.pause(userId, live);
    expect(await paths.next(userId)).toBeNull();
  });
});

// P2-W10-S07 (Q-P2-29): a section whose live concepts are all mastered.
test("a section is mastered when every live concept in it is, for this user", async () => {
  await inRollback(async (trx, { userId, live }) => {
    const paths = kyselyPaths(trx);
    await paths.start(userId, live);
    const concepts = await trx
      .selectFrom("path_section_concept as pc")
      .innerJoin("path_section as s", "s.id", "pc.section_id")
      .select(["pc.concept_id", "pc.section_id"])
      .where("s.path_id", "=", live)
      .orderBy("s.ordinal")
      .execute();
    const [c1, c2] = concepts;
    if (!c1 || !c2) throw new Error("seed");
    const mastered = async () =>
      (await paths.path(userId, live))?.sections.map((s) => s.mastered);
    const set = (state: "practiced" | "mastered") =>
      trx
        .insertInto("concept_mastery")
        .values({
          user_id: userId,
          concept_id: c1.concept_id,
          probability: state === "mastered" ? 0.9 : 0.6,
          state,
          evidence_count: 3,
        })
        .onConflict((oc) =>
          oc.columns(["user_id", "concept_id"]).doUpdateSet({ state }),
        )
        .execute();
    expect(await mastered()).toEqual([false, false]);
    await set("practiced");
    expect(await mastered()).toEqual([false, false]);
    await set("mastered");
    expect(await mastered()).toEqual([true, false]);
    expect(await paths.next(userId)).toMatchObject({
      kind: "reading",
      sectionId: c1.section_id,
      mastered: true,
    });
    // A passed section with a reading left (a swap) isn't offered for skipping.
    await trx
      .insertInto("quiz_attempt")
      .values({
        user_id: userId,
        path_section_id: c1.section_id,
        checkpoint_size: 1,
        ends_at: sql<Date>`now() + interval '1 minute'`,
        finished_at: sql<Date>`now()`,
        checkpoint_passed: true,
      })
      .execute();
    expect(await paths.next(userId)).toMatchObject({
      sectionId: c1.section_id,
      mastered: false,
    });
    await trx
      .deleteFrom("quiz_attempt")
      .where("path_section_id", "=", c1.section_id)
      .execute();
    // Someone else's mastery doesn't count.
    expect(
      (await paths.path("someone-else", live))?.sections[0]?.mastered,
    ).toBe(false);
    // A retired concept in the section doesn't hold it back.
    const old = await trx
      .insertInto("concept")
      .values({
        slug: `old-${randomUUID()}`,
        name: "Old",
        topic: "distributed-systems",
        retired_at: sql<Date>`now()`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("path_section_concept")
      .values({ section_id: c1.section_id, concept_id: old.id })
      .execute();
    expect(await mastered()).toEqual([true, false]);
    // Its only live concept retired too, the section has none: not mastered.
    await trx
      .updateTable("concept")
      .set({ retired_at: sql<Date>`now()` })
      .where("id", "=", c1.concept_id)
      .execute();
    expect(await mastered()).toEqual([false, false]);
  });
});

// P2-W10-S08 (Q-P2-30): direct prerequisites outside the path, never explored.
test("an open section lists its missing foundations, each with a reading if one is allowed", async () => {
  await inRollback(async (trx, { userId, live, moments }) => {
    const paths = kyselyPaths(trx);
    const [one] = await sectionsOf(trx, userId, live);
    const [m1] = moments;
    if (!m1) throw new Error("seed");
    await paths.start(userId, live);
    const inPath = await trx
      .selectFrom("path_section_concept as pc")
      .innerJoin("path_section as s", "s.id", "pc.section_id")
      .select("pc.concept_id")
      .where("s.path_id", "=", live)
      .orderBy("s.ordinal")
      .execute();
    const [c1, c2] = inPath.map((c) => c.concept_id);
    if (!c1 || !c2) throw new Error("seed");
    const made = await trx
      .insertInto("concept")
      .values(
        // Ids out of name order, so the listing's order is by name.
        ["F3", "F1", "F4", "F2", "Deeper", "Retired"].map((name) => ({
          slug: `${name.toLowerCase()}-${randomUUID()}`,
          name,
          topic: "databases" as const,
          retired_at: name === "Retired" ? sql<Date>`now()` : null,
        })),
      )
      .returning(["id", "name"])
      .execute();
    const id = (name: string) => made.find((c) => c.name === name)?.id ?? "0";
    const edge = (from: string, to: string) =>
      trx
        .insertInto("concept_edge")
        .values({ from_id: from, to_id: to, type: "prerequisite_of" })
        .execute();
    for (const f of ["F1", "F2", "F3", "F4", "Retired"]) await edge(id(f), c1);
    await edge(id("Deeper"), id("F1")); // two hops: not listed
    await edge(c2, c1); // taught by the path itself: not listed
    await edge(id("F4"), c2); // section two's, listed only once it opens
    // F1 has a reading; F2's only reading is behind a broken link (ING-6), F3's in a
    // source whose rights were lowered since (ING-2).
    const source = await trx
      .selectFrom("moment")
      .innerJoin("content_item", "content_item.id", "moment.content_item_id")
      .select("content_item.source_id")
      .where("moment.id", "=", m1)
      .executeTakeFirstOrThrow();
    const lowered = await trx
      .insertInto("source")
      .values({
        name: `foundation-${randomUUID()}`,
        feed_url: `https://follow.example.test/${randomUUID()}.xml`,
        rights_profile: "full_text_internal",
        moments_seeded: true,
        moments_enabled: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const [f, broken, sourceId] of [
      ["F1", false, source.source_id],
      ["F2", true, source.source_id],
      ["F3", false, lowered.id],
    ] as const) {
      const item = await trx
        .insertInto("content_item")
        .values({
          source_id: sourceId,
          guid: randomUUID(),
          canonical_url: `https://follow.example.test/${f}`,
          title: `On ${f}`,
          frameable: true,
          link_broken_at: broken ? sql<Date>`now()` : null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moment = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 0,
          title: `${f} basics`,
          estimated_minutes: 4,
          link: `https://follow.example.test/${f}#a`,
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("moment_tagging")
        .values({ moment_id: moment.id, difficulty: "beginner" })
        .execute();
      await trx
        .insertInto("moment_concept")
        .values({ moment_id: moment.id, concept_id: id(f) })
        .execute();
    }
    await sql`set local session_replication_role = replica`.execute(trx);
    await trx
      .updateTable("source")
      .set({ rights_profile: "metadata_only" })
      .where("id", "=", lowered.id)
      .execute();
    await sql`set local session_replication_role = origin`.execute(trx);
    const listed = async () =>
      (await paths.path(userId, live))?.sections.map((s) =>
        s.foundations.map((f) => [f.name, f.reading?.sectionTitle ?? null]),
      );
    // Up to 3 by name; the locked second section lists none.
    expect(await listed()).toEqual([
      [
        ["F1", "F1 basics"],
        ["F2", null],
        ["F3", null],
      ],
      [],
    ]);
    // Explored (any mastery row): gone, and the fourth shows.
    await trx
      .insertInto("concept_mastery")
      .values({
        user_id: userId,
        concept_id: id("F1"),
        probability: 0.2,
        state: "explored",
        evidence_count: 1,
      })
      .execute();
    expect((await listed())?.[0]?.map(([name]) => name)).toEqual([
      "F2",
      "F3",
      "F4",
    ]);
    // A skipped section lists none; the second, open now, lists its own.
    await paths.skipSection(userId, one);
    expect(await listed()).toEqual([[], [["F4", null]]]);
  });
});
