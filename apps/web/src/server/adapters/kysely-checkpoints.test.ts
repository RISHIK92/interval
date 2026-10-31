import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { QuizQuestion } from "../ports";
import { createDb } from "./kysely";
import { kyselyPaths } from "./kysely-paths";
import { kyselyQuizzes } from "./kysely-quizzes";

// Checkpoints (§5F, Q-P2-26, P2-W10-S04): a 60-second quiz on a path section once its
// readings are finished; 4 of 5 (all but one of fewer) opens the next section.
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
  otherUser: string;
  pathId: string;
  first: string; // section 1: reading m1, concepts c1 (questions) and c3, c4 (none)
  second: string; // section 2: reading m2, concept c2 (two questions)
  m1: string;
  m2: string;
  sourceId: string;
  concept: Record<"c1" | "c2" | "c3" | "c4", string>;
  q: Record<string, string>; // stem → id
};

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const sources = await trx
        .insertInto("source")
        .values(
          ["on", "metadata"].map((n) => ({
            name: `checkpoint-${n}-${randomUUID()}`,
            feed_url: `https://checkpoint.example.test/${randomUUID()}.xml`,
            rights_profile: "full_text_internal" as const,
            moments_seeded: true,
            moments_enabled: true,
          })),
        )
        .returning("id")
        .execute();
      const [on, lowered] = sources;
      if (!on || !lowered) throw new Error("seed");
      const items = await trx
        .insertInto("content_item")
        .values(
          [on, on, on, lowered].map((s, n) => ({
            source_id: s.id,
            guid: randomUUID(),
            canonical_url: `https://checkpoint.example.test/${String(n)}`,
            title: `Article ${String(n + 1)}`,
          })),
        )
        .returning("id")
        .execute();
      const moments = (
        await trx
          .insertInto("moment")
          .values(
            items.map((item, n) => ({
              content_item_id: item.id,
              ordinal: 0,
              title: `M${String(n + 1)}`,
              estimated_minutes: 3,
              link: `https://checkpoint.example.test/${String(n)}#a`,
              link_type: "anchor" as const,
            })),
          )
          .returning("id")
          .execute()
      ).map((m) => m.id);
      const [m1, m2, elsewhere, hidden] = moments;
      if (!m1 || !m2 || !elsewhere || !hidden) throw new Error("seed");
      const made = await trx
        .insertInto("concept")
        .values(
          ["c1", "c2", "c3", "c4"].map((slug) => ({
            slug: `${slug}-${randomUUID()}`,
            name: slug.toUpperCase(),
            topic: "distributed-systems",
          })),
        )
        .returning("id")
        .execute();
      const [c1, c2, c3, c4] = made.map((c) => c.id);
      if (!c1 || !c2 || !c3 || !c4) throw new Error("seed");
      const q: Record<string, string> = {};
      const question = async (
        momentId: string,
        ordinal: number,
        stem: string,
        concept: string,
      ) => {
        const row = await trx
          .insertInto("question")
          .values({
            moment_id: momentId,
            ordinal,
            stem,
            options: ["right", "w1", "w2", "w3"],
            correct: 0,
            citation: "a b c",
            status: "live",
            generator_model: "m",
            prompt_version: 1,
            content_hash: "h",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("question_concept")
          .values({ question_id: row.id, concept_id: concept })
          .execute();
        q[stem] = row.id;
      };
      // Section 1's own reading has three; section 2's two, on c2; a reading in no
      // path has three more on c1, which section 1 asks after its own. "hidden" is on c1 in a source whose
      // rights are lowered below: never asked (ING-2).
      for (const i of [0, 1, 2]) await question(m1, i, `own-${String(i)}`, c1);
      for (const i of [0, 1]) await question(m2, i, `two-${String(i)}`, c2);
      for (const i of [2, 3, 4])
        await question(elsewhere, i, `rel-${String(i)}`, c1);
      await question(hidden, 0, "hidden", c1);
      await sql`set local session_replication_role = replica`.execute(trx);
      await trx
        .updateTable("source")
        .set({ rights_profile: "metadata_only" })
        .where("id", "=", lowered.id)
        .execute();
      await sql`set local session_replication_role = origin`.execute(trx);
      const path = await trx
        .insertInto("path")
        .values({
          name: "Replication",
          why: "Why.",
          model: "m",
          prompt_version: 1,
          status: "live",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const sections: string[] = [];
      for (const [ordinal, [moment, concepts]] of [
        [m1, [c1, c3, c4]],
        [m2, [c2]],
      ].entries()) {
        const section = await trx
          .insertInto("path_section")
          .values({ path_id: path.id, ordinal: ordinal * 10 })
          .returning("id")
          .executeTakeFirstOrThrow();
        sections.push(section.id);
        await trx
          .insertInto("path_section_concept")
          .values(
            (concepts as string[]).map((concept_id) => ({
              section_id: section.id,
              concept_id,
            })),
          )
          .execute();
        await trx
          .insertInto("path_session")
          .values({
            section_id: section.id,
            ordinal: 0,
            moment_id: moment as string,
          })
          .execute();
      }
      const [first, second] = sections;
      if (!first || !second) throw new Error("seed");
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `CHK${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 2,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const userId = randomUUID();
      for (const id of [userId, `${userId}-other`])
        await trx
          .insertInto("app_user")
          .values({
            id,
            name: "n",
            email: `${id}@example.test`,
            beta_group: "student",
            invite_code_id: code.id,
          })
          .execute();
      await trx
        .insertInto("user_path")
        .values({ user_id: userId, path_id: path.id, status: "active" })
        .execute();
      await body(trx, {
        userId,
        otherUser: `${userId}-other`,
        pathId: path.id,
        first,
        second,
        m1,
        m2,
        sourceId: on.id,
        concept: { c1, c2, c3, c4 },
        q,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

function served(got: QuizQuestion | "over" | null): QuizQuestion {
  if (got === null || got === "over") throw new Error("expected a question");
  return got;
}

const finish = (trx: Transaction<DB>, userId: string, momentId: string) =>
  trx
    .insertInto("user_moment_finished")
    .values({ user_id: userId, moment_id: momentId, method: "mark_done" })
    .execute();

// Answers every question it serves: right for the stems in `right`, else wrong.
async function take(
  trx: Transaction<DB>,
  userId: string,
  attemptId: string,
  right: (stem: string, i: number) => boolean,
): Promise<string[]> {
  const quizzes = kyselyQuizzes(trx);
  const stems: string[] = [];
  for (;;) {
    const got = await quizzes.next(userId, attemptId);
    if (got === "over") return stems;
    const one = served(got);
    await quizzes.answer(
      userId,
      attemptId,
      one.questionId,
      right(one.stem, stems.length) ? 0 : 1,
    );
    stems.push(one.stem);
  }
}

test("a checkpoint starts once its section is open and its readings are finished", async () => {
  await inRollback(
    async (trx, { userId, otherUser, pathId, first, second, m1 }) => {
      const quizzes = kyselyQuizzes(trx);
      expect(await quizzes.startCheckpoint(userId, first)).toBeNull();
      expect(
        (await kyselyPaths(trx).path(userId, pathId))?.sections.map(
          (s) => s.checkpoint,
        ),
      ).toEqual(["reading", "locked"]);
      await finish(trx, userId, m1);
      // The second section waits for the first's checkpoint.
      expect(await quizzes.startCheckpoint(userId, second)).toBeNull();
      // Not on a path the user hasn't started.
      await finish(trx, otherUser, m1);
      expect(await quizzes.startCheckpoint(otherUser, first)).toBeNull();
      const started = await quizzes.startCheckpoint(userId, first);
      expect(started).toMatchObject({ firstTime: true });
      // A double tap meets the running one (LOAD-5).
      expect(await quizzes.startCheckpoint(userId, first)).toEqual({
        ...started,
        firstTime: false,
      });
      const attempt = await quizzes.attempt(userId, started?.attemptId ?? "");
      expect(attempt).toMatchObject({
        review: false,
        itemId: null,
        title: "C1, C3, C4",
        checkpoint: {
          at: { kind: "path", sectionId: first },
          size: 5,
          passMark: 4,
          next: ["C2"],
        },
      });
      expect(attempt?.secondsLeft).toBeGreaterThan(55);
    },
  );
});

test("it asks 5: the section's own readings first, never a source its rights forbid", async () => {
  await inRollback(async (trx, { userId, first, m1 }) => {
    await finish(trx, userId, m1);
    // An estimate is answered with a number: never in a checkpoint (P3-W13-S03).
    await estimateOn(trx, { moment_id: m1 });
    const started = await kyselyQuizzes(trx).startCheckpoint(userId, first);
    const stems = await take(trx, userId, started?.attemptId ?? "", () => true);
    expect(stems).toHaveLength(5);
    expect(stems.slice(0, 3)).toEqual(["own-0", "own-1", "own-2"]);
    expect(stems.slice(3).every((s) => s.startsWith("rel-"))).toBe(true);
  });
});

test("4 of 5 passes: its concepts practiced, misses due now, the next section open", async () => {
  await inRollback(
    async (trx, { userId, pathId, first, second, m1, concept }) => {
      await trx
        .insertInto("concept_mastery")
        .values({
          user_id: userId,
          concept_id: concept.c4,
          probability: 0.9,
          state: "mastered",
          evidence_count: 4,
        })
        .execute();
      await finish(trx, userId, m1);
      const quizzes = kyselyQuizzes(trx);
      const started = await quizzes.startCheckpoint(userId, first);
      const attemptId = started?.attemptId ?? "";
      await take(trx, userId, attemptId, (_, i) => i !== 2);
      expect(await quizzes.finish(userId, attemptId)).toMatchObject({
        answered: 5,
        correct: 4,
        checkpoint: {
          at: { kind: "path", pathId, sectionId: first },
          passed: true,
        },
      });
      const mastery = Object.fromEntries(
        (
          await trx
            .selectFrom("concept_mastery")
            .select(["concept_id", "state", "probability"])
            .where("user_id", "=", userId)
            .execute()
        ).map((r) => [r.concept_id, r]),
      );
      // C3 had no question: practiced by the pass. C4 stays mastered.
      expect(mastery[concept.c3]).toMatchObject({
        state: "practiced",
        probability: 0.5,
      });
      expect(mastery[concept.c4]).toMatchObject({
        state: "mastered",
        probability: 0.9,
      });
      expect(mastery[concept.c1]?.state).not.toBe("explored");
      // The miss was on C1: in review now.
      const card = await trx
        .selectFrom("concept_review")
        .select(sql<boolean>`due <= now()`.as("due"))
        .where("user_id", "=", userId)
        .where("concept_id", "=", concept.c1)
        .executeTakeFirstOrThrow();
      expect(card.due).toBe(true);
      expect(
        (await quizzes.attempt(userId, attemptId))?.checkpoint,
      ).toMatchObject({ passed: true, missed: ["C1"] });
      const timeline = await kyselyPaths(trx).path(userId, pathId);
      expect(timeline?.sections.map((s) => [s.open, s.checkpoint])).toEqual([
        [true, "passed"],
        [true, "reading"],
      ]);
      // A passed section isn't taken again.
      expect(await quizzes.startCheckpoint(userId, first)).toBeNull();
      // Section 2 is open now, and waits for its reading.
      expect(await quizzes.startCheckpoint(userId, second)).toBeNull();
    },
  );
});

test("3 of 5 doesn't: the next section stays locked, and a retry asks others first", async () => {
  await inRollback(async (trx, { userId, pathId, first, m1, concept }) => {
    await finish(trx, userId, m1);
    const quizzes = kyselyQuizzes(trx);
    const one = await quizzes.startCheckpoint(userId, first);
    const asked = await take(
      trx,
      userId,
      one?.attemptId ?? "",
      (_, i) => i < 3,
    );
    expect(await quizzes.finish(userId, one?.attemptId ?? "")).toMatchObject({
      correct: 3,
      checkpoint: { passed: false },
    });
    expect(
      (await kyselyPaths(trx).path(userId, pathId))?.sections.map(
        (s) => s.checkpoint,
      ),
    ).toEqual(["ready", "locked"]);
    expect(
      await trx
        .selectFrom("concept_mastery")
        .select("state")
        .where("user_id", "=", userId)
        .where("concept_id", "=", concept.c3)
        .executeTakeFirst(),
    ).toBeUndefined();
    const again = await quizzes.startCheckpoint(userId, first);
    expect(again?.firstTime).toBe(true);
    const first2 = served(await quizzes.next(userId, again?.attemptId ?? ""));
    // Six to ask, five asked last time: the one left comes first.
    expect(asked).not.toContain(first2.stem);
  });
});

test("a smaller section passes with all but one", async () => {
  await inRollback(async (trx, { userId, pathId, first, second, m1, m2 }) => {
    const quizzes = kyselyQuizzes(trx);
    await finish(trx, userId, m1);
    const one = await quizzes.startCheckpoint(userId, first);
    await take(trx, userId, one?.attemptId ?? "", () => true);
    await quizzes.finish(userId, one?.attemptId ?? "");
    await finish(trx, userId, m2);
    const two = await quizzes.startCheckpoint(userId, second);
    const attemptId = two?.attemptId ?? "";
    expect(
      (await quizzes.attempt(userId, attemptId))?.checkpoint,
    ).toMatchObject({ size: 2, passMark: 1, next: null });
    expect(await take(trx, userId, attemptId, (_, i) => i === 0)).toHaveLength(
      2,
    );
    expect(await quizzes.finish(userId, attemptId)).toMatchObject({
      checkpoint: { passed: true },
    });
    expect(
      (await kyselyPaths(trx).path(userId, pathId))?.sections.map(
        (s) => s.checkpoint,
      ),
    ).toEqual(["passed", "passed"]);
  });
});

test("a checkpoint left behind closes at its clock and still counts", async () => {
  await inRollback(async (trx, { userId, pathId, first, m1 }) => {
    const quizzes = kyselyQuizzes(trx);
    await finish(trx, userId, m1);
    const one = await quizzes.startCheckpoint(userId, first);
    const attemptId = one?.attemptId ?? "";
    await take(trx, userId, attemptId, () => true);
    await trx
      .updateTable("quiz_attempt")
      .set({
        started_at: sql<Date>`now() - interval '2 minutes'`,
        ends_at: sql<Date>`now() - interval '1 minute'`,
      })
      .where("id", "=", attemptId)
      .execute();
    // Closed before the next start (and settled): passed, so nothing new starts.
    await quizzes.closeStale(userId);
    expect(await quizzes.startCheckpoint(userId, first)).toBeNull();
    expect(
      (await kyselyPaths(trx).path(userId, pathId))?.sections[0]?.checkpoint,
    ).toBe("passed");
  });
});

test("no checkpoint without a live question its rights allow (ING-2)", async () => {
  await inRollback(async (trx, { userId, pathId, first, m1, sourceId }) => {
    await finish(trx, userId, m1);
    await sql`set local session_replication_role = replica`.execute(trx);
    await trx
      .updateTable("source")
      .set({ rights_profile: "metadata_only" })
      .where("id", "=", sourceId)
      .execute();
    await sql`set local session_replication_role = origin`.execute(trx);
    expect(
      (await kyselyPaths(trx).path(userId, pathId))?.sections[0]?.checkpoint,
    ).toBe("no_questions");
    expect(await kyselyQuizzes(trx).startCheckpoint(userId, first)).toBeNull();
  });
});

test("a pass stays when its answers go with their questions (a re-split, ING-2)", async () => {
  await inRollback(async (trx, { userId, pathId, first, m1, q }) => {
    const quizzes = kyselyQuizzes(trx);
    await finish(trx, userId, m1);
    const one = await quizzes.startCheckpoint(userId, first);
    await take(trx, userId, one?.attemptId ?? "", () => true);
    await quizzes.finish(userId, one?.attemptId ?? "");
    await trx
      .deleteFrom("question")
      .where("id", "in", [q["own-0"] ?? "0", q["own-1"] ?? "0"])
      .execute();
    expect(
      (await kyselyPaths(trx).path(userId, pathId))?.sections.map(
        (s) => s.open,
      ),
    ).toEqual([true, true]);
  });
});

test("a broken link doesn't hold a checkpoint back; a paused path doesn't start one", async () => {
  await inRollback(async (trx, { userId, pathId, first, m1 }) => {
    const quizzes = kyselyQuizzes(trx);
    const item = await trx
      .selectFrom("moment")
      .select("content_item_id")
      .where("id", "=", m1)
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("content_item")
      .set({ link_broken_at: sql<Date>`now()` })
      .where("id", "=", item.content_item_id)
      .execute();
    expect(
      (await kyselyPaths(trx).path(userId, pathId))?.sections[0]?.checkpoint,
    ).toBe("ready");
    await trx
      .updateTable("user_path")
      .set({ status: "paused" })
      .where("user_id", "=", userId)
      .execute();
    expect(await quizzes.startCheckpoint(userId, first)).toBeNull();
  });
});

test("checkpoints follow the user's copy: a skipped section has none, a moved one opens first", async () => {
  await inRollback(async (trx, { userId, first, second, m1, m2 }) => {
    const quizzes = kyselyQuizzes(trx);
    const paths = kyselyPaths(trx);
    await finish(trx, userId, m1);
    await finish(trx, userId, m2);
    // Section 2 moved ahead: open, and section 1 now waits for it.
    await paths.moveSection(userId, second, "up");
    expect(await quizzes.startCheckpoint(userId, first)).toBeNull();
    const two = await quizzes.startCheckpoint(userId, second);
    expect(two?.firstTime).toBe(true);
    await take(trx, userId, two?.attemptId ?? "", () => true);
    await quizzes.finish(userId, two?.attemptId ?? "");
    // Skipped: no checkpoint, until it's unskipped.
    await paths.skipSection(userId, first);
    expect(await quizzes.startCheckpoint(userId, first)).toBeNull();
    await paths.unskipSection(userId, first);
    expect(await quizzes.startCheckpoint(userId, first)).toMatchObject({
      firstTime: true,
    });
  });
});

test("next offers a ready checkpoint; closeStale returns the checkpoint it closed", async () => {
  await inRollback(async (trx, { userId, pathId, first, m1 }) => {
    const quizzes = kyselyQuizzes(trx);
    await finish(trx, userId, m1);
    expect(await kyselyPaths(trx).next(userId)).toMatchObject({
      kind: "checkpoint",
      pathId,
      sectionId: first,
      concepts: ["C1", "C3", "C4"],
      size: 5,
      passMark: 4,
      next: ["C2"],
    });
    const one = await quizzes.startCheckpoint(userId, first);
    const attemptId = one?.attemptId ?? "";
    await take(trx, userId, attemptId, () => true);
    expect(await quizzes.closeStale(userId)).toEqual([]);
    await trx
      .updateTable("quiz_attempt")
      .set({
        started_at: sql<Date>`now() - interval '2 minutes'`,
        ends_at: sql<Date>`now() - interval '1 minute'`,
      })
      .where("id", "=", attemptId)
      .execute();
    expect(await quizzes.closeStale(userId)).toEqual([
      {
        attemptId,
        answered: 5,
        correct: 5,
        firstTime: true,
        checkpoint: {
          at: { kind: "path", pathId, sectionId: first },
          passed: true,
        },
        sprint: false,
      },
    ]);
    // Closed once: a second call has nothing.
    expect(await quizzes.closeStale(userId)).toEqual([]);
  });
});

async function estimateOn(
  trx: Transaction<DB>,
  home: { moment_id: string } | { book_chapter_id: string },
) {
  await trx
    .insertInto("question")
    .values({
      ...home,
      ordinal: 9,
      kind: "estimate",
      stem: "an estimate",
      answer: 300,
      unit: "ms",
      citation: "a b c",
      status: "live",
      generator_model: "m",
      prompt_version: 1,
      content_hash: "h",
    })
    .execute();
}

// P2-W11-S06 (§5F, Q-P2-35): a book chapter's checkpoint, its questions made from the
// chapter for its owner alone. Its concept here is c3, which has no public question.
async function aBookChapter(
  trx: Transaction<DB>,
  userId: string,
  concept: string,
  live: number,
): Promise<{ bookId: string; chapterId: string; questions: string[] }> {
  const book = await trx
    .insertInto("book")
    .values({
      user_id: userId,
      title: "Designing Data Systems",
      file_key: `books/${userId}/${randomUUID()}.pdf`,
      size_bytes: 100,
      status: "ready",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const chapter = await trx
    .insertInto("book_chapter")
    .values({ book_id: book.id, ordinal: 0, title: "Replication" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("book_chapter_checkpoint")
    .values({ chapter_id: chapter.id, status: "ready" })
    .execute();
  await trx
    .insertInto("book_chapter_concept")
    .values({ chapter_id: chapter.id, concept_id: concept })
    .execute();
  const questions: string[] = [];
  for (let n = 0; n < live; n++) {
    const row = await trx
      .insertInto("question")
      .values({
        book_chapter_id: chapter.id,
        ordinal: n,
        stem: `Book ${String(n)}`,
        options: ["right", "w1", "w2", "w3"],
        correct: 0,
        citation: "a b c",
        status: "live",
        generator_model: "m",
        prompt_version: 1,
        content_hash: "h",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("question_concept")
      .values({ question_id: row.id, concept_id: concept })
      .execute();
    questions.push(row.id);
  }
  return { bookId: book.id, chapterId: chapter.id, questions };
}

test("a book chapter's checkpoint asks its own questions; a pass marks its concepts practiced", async () => {
  await inRollback(async (trx, { userId, otherUser, concept }) => {
    const quizzes = kyselyQuizzes(trx);
    const { bookId, chapterId } = await aBookChapter(
      trx,
      userId,
      concept.c3,
      3,
    );
    await estimateOn(trx, { book_chapter_id: chapterId });
    // Not the user's book: nothing.
    expect(await quizzes.startBookCheckpoint(otherUser, chapterId)).toBeNull();
    const started = await quizzes.startBookCheckpoint(userId, chapterId);
    expect(started).toMatchObject({ bookId, firstTime: true });
    if (started === null) throw new Error("started");
    // A double tap meets the same one.
    expect(await quizzes.startBookCheckpoint(userId, chapterId)).toMatchObject({
      attemptId: started.attemptId,
      firstTime: false,
    });
    const info = await quizzes.attempt(userId, started.attemptId);
    expect(info?.title).toBe("Replication");
    expect(info?.checkpoint).toMatchObject({
      at: { kind: "book", bookId, chapterId },
      size: 3,
      passMark: 2,
      next: null,
      concepts: ["C3"],
    });
    // Three of its own questions, then over; one wrong.
    const stems = await take(trx, userId, started.attemptId, (_, i) => i !== 2);
    expect(stems.sort()).toEqual(["Book 0", "Book 1", "Book 2"]);
    const done = await quizzes.finish(userId, started.attemptId);
    expect(done?.checkpoint).toEqual({
      at: { kind: "book", bookId, chapterId },
      passed: true,
    });
    const c3 = await trx
      .selectFrom("concept_mastery")
      .select("state")
      .where("user_id", "=", userId)
      .where("concept_id", "=", concept.c3)
      .executeTakeFirstOrThrow();
    expect(c3.state).not.toBe("explored");
    // Its miss is due for review, but only its owner could be asked it: the review
    // queue reads public questions, and c3 has none.
    const review = await trx
      .selectFrom("concept_review")
      .select(sql<boolean>`due <= now()`.as("due"))
      .where("user_id", "=", userId)
      .where("concept_id", "=", concept.c3)
      .executeTakeFirstOrThrow();
    expect(review.due).toBe(true);
    // A pass can be taken again (chapters don't lock).
    expect(await quizzes.startBookCheckpoint(userId, chapterId)).toMatchObject({
      firstTime: true,
    });
  });
});

test("a chapter checkpoint not ready, or of a book not ready, doesn't start", async () => {
  await inRollback(async (trx, { userId, concept }) => {
    const quizzes = kyselyQuizzes(trx);
    const { bookId, chapterId } = await aBookChapter(
      trx,
      userId,
      concept.c3,
      2,
    );
    await trx
      .updateTable("book_chapter_checkpoint")
      .set({ status: "preparing" })
      .where("chapter_id", "=", chapterId)
      .execute();
    expect(await quizzes.startBookCheckpoint(userId, chapterId)).toBeNull();
    await trx
      .updateTable("book_chapter_checkpoint")
      .set({ status: "ready" })
      .where("chapter_id", "=", chapterId)
      .execute();
    await trx
      .updateTable("book")
      .set({ status: "ocr" })
      .where("id", "=", bookId)
      .execute();
    expect(await quizzes.startBookCheckpoint(userId, chapterId)).toBeNull();
  });
});

test("a book's questions never reach anyone else's quiz or review", async () => {
  await inRollback(async (trx, { userId, otherUser, concept, first, m1 }) => {
    const quizzes = kyselyQuizzes(trx);
    // The owner's book tests c1, which the public section 1 also tests.
    const { questions } = await aBookChapter(trx, userId, concept.c1, 3);
    const leaked = (asked: string[]) => {
      expect(asked.filter((id) => questions.includes(id))).toEqual([]);
    };
    // Another user's review of c1, due now.
    await trx
      .insertInto("concept_review")
      .values({
        user_id: otherUser,
        concept_id: concept.c1,
        due: sql<Date>`now() - interval '1 day'`,
        stability: 3,
        difficulty: 5,
        scheduled_days: 3,
        learning_steps: 0,
        reps: 1,
        lapses: 0,
        state: 2,
        last_review: sql<Date>`now() - interval '3 days'`,
      })
      .execute();
    const review = await quizzes.startReview(otherUser);
    if (review === null) throw new Error("review");
    const asked: string[] = [];
    for (;;) {
      const got = await quizzes.next(otherUser, review.attemptId);
      if (got === "over" || got === null) break;
      asked.push(got.questionId);
      await quizzes.answer(otherUser, review.attemptId, got.questionId, 0);
    }
    leaked(asked);
    // The owner's own Test 60s on a public moment, and the path checkpoint on c1.
    const item = await trx
      .selectFrom("moment")
      .select("content_item_id")
      .where("id", "=", m1)
      .executeTakeFirstOrThrow();
    const sprint = await quizzes.start(userId, item.content_item_id, m1);
    if (sprint === null) throw new Error("sprint");
    const sprinted: string[] = [];
    for (;;) {
      const got = await quizzes.next(userId, sprint.attemptId);
      if (got === "over" || got === null) break;
      sprinted.push(got.questionId);
      await quizzes.answer(userId, sprint.attemptId, got.questionId, 0);
    }
    leaked(sprinted);
    await finish(trx, userId, m1);
    const checkpoint = await quizzes.startCheckpoint(userId, first);
    if (checkpoint === null) throw new Error("checkpoint");
    const stems = await take(trx, userId, checkpoint.attemptId, () => true);
    expect(stems.some((stem) => stem.startsWith("Book"))).toBe(false);
  });
});

test("a flag on a book's question is kept, but the question stays and no one reviews it", async () => {
  await inRollback(async (trx, { userId, concept }) => {
    const quizzes = kyselyQuizzes(trx);
    const { chapterId, questions } = await aBookChapter(
      trx,
      userId,
      concept.c3,
      2,
    );
    const started = await quizzes.startBookCheckpoint(userId, chapterId);
    if (started === null) throw new Error("started");
    const asked = served(await quizzes.next(userId, started.attemptId));
    await quizzes.answer(userId, started.attemptId, asked.questionId, 0);
    expect(
      await quizzes.flag(
        userId,
        started.attemptId,
        asked.questionId,
        "wrong_key",
      ),
    ).toBe(true);
    const row = await trx
      .selectFrom("question")
      .select("status")
      .where("id", "=", asked.questionId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("live");
    const reviews = await trx
      .selectFrom("question_review")
      .select("question_id")
      .where("question_id", "in", questions)
      .execute();
    expect(reviews).toEqual([]);
  });
});
