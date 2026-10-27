import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { QuizQuestion } from "../ports";
import { createDb } from "./kysely";
import { kyselyQuizzes } from "./kysely-quizzes";

// Test 60s (Q-P2-14, P2-W9-S01): the server serves a sprint over a moment's or an
// article's concepts, checks each answer once, and holds the clock.
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
  itemId: string;
  intro: string;
  raft: string;
  // stems → question id
  q: Record<string, string>;
};

async function source(trx: Transaction<DB>) {
  return trx
    .insertInto("source")
    .values({
      name: `quiz-${randomUUID()}`,
      feed_url: `https://quiz.example.test/${randomUUID()}.xml`,
      rights_profile: "full_text_internal",
      moments_seeded: true,
      moments_enabled: true,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
}

async function article(
  trx: Transaction<DB>,
  sourceId: string,
  titles: string[],
): Promise<{ itemId: string; momentIds: string[] }> {
  const item = await trx
    .insertInto("content_item")
    .values({
      source_id: sourceId,
      guid: randomUUID(),
      canonical_url: `https://quiz.example.test/${randomUUID()}`,
      title: "Consensus",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const moments = await trx
    .insertInto("moment")
    .values(
      titles.map((title, ordinal) => ({
        content_item_id: item.id,
        ordinal,
        title,
        estimated_minutes: 3,
        link: `https://quiz.example.test/post#${title.toLowerCase()}`,
        link_type: "anchor" as const,
      })),
    )
    .returning("id")
    .execute();
  return { itemId: item.id, momentIds: moments.map((m) => m.id) };
}

async function question(
  trx: Transaction<DB>,
  momentId: string,
  ordinal: number,
  stem: string,
  concepts: string[],
  status: "live" | "pending" | "rejected" | "retired" = "live",
): Promise<string> {
  const row = await trx
    .insertInto("question")
    .values({
      moment_id: momentId,
      ordinal,
      stem,
      options: ["right", "w1", "w2", "w3"],
      correct: 0,
      citation: "a b c",
      status,
      generator_model: "m",
      prompt_version: 1,
      content_hash: "h",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  if (concepts.length > 0)
    await trx
      .insertInto("question_concept")
      .values(concepts.map((c) => ({ question_id: row.id, concept_id: c })))
      .execute();
  return row.id;
}

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const on = await source(trx);
      const off = await source(trx);
      const [raftConcept, walConcept, oldConcept] = await trx
        .insertInto("concept")
        .values(
          ["raft", "wal", "old"].map((slug) => ({
            slug: `${slug}-${randomUUID()}`,
            name: slug,
            topic: "distributed-systems",
          })),
        )
        .returning("id")
        .execute();
      if (!raftConcept || !walConcept || !oldConcept) throw new Error("seed");
      await trx
        .updateTable("concept")
        .set({ retired_at: sql<Date>`now()` })
        .where("id", "=", oldConcept.id)
        .execute();
      const main = await article(trx, on.id, ["Intro", "Raft"]);
      const other = await article(trx, on.id, ["Elsewhere"]);
      const hidden = await article(trx, off.id, ["Hidden"]);
      const [intro, raft] = main.momentIds;
      const [elsewhere] = other.momentIds;
      const [hiddenMoment] = hidden.momentIds;
      if (!intro || !raft || !elsewhere || !hiddenMoment)
        throw new Error("seed");
      const q: Record<string, string> = {};
      // Also on the retired concept: a sprint must not follow it to "only-old".
      q["raft-0"] = await question(trx, raft, 0, "raft-0", [
        raftConcept.id,
        oldConcept.id,
      ]);
      q["raft-1"] = await question(trx, raft, 1, "raft-1", [raftConcept.id]);
      q["intro-0"] = await question(trx, intro, 0, "intro-0", [walConcept.id]);
      q["pending"] = await question(
        trx,
        raft,
        2,
        "pending",
        [raftConcept.id],
        "pending",
      );
      q["elsewhere"] = await question(trx, elsewhere, 0, "elsewhere", [
        raftConcept.id,
      ]);
      q["rejected"] = await question(
        trx,
        elsewhere,
        1,
        "rejected",
        [raftConcept.id],
        "rejected",
      );
      q["only-old"] = await question(trx, elsewhere, 2, "only-old", [
        oldConcept.id,
      ]);
      q["hidden"] = await question(trx, hiddenMoment, 0, "hidden", [
        raftConcept.id,
      ]);
      // Switched off after seeding (moments can't be added once off), its purge
      // trigger held back for this transaction so the moments stay: the quiz's own
      // rights filter must keep "hidden" out (ING-2), not the purge.
      await sql`set local session_replication_role = replica`.execute(trx);
      await trx
        .updateTable("source")
        .set({ moments_switched_off: true, moments_enabled: false })
        .where("id", "=", off.id)
        .execute();
      await sql`set local session_replication_role = origin`.execute(trx);
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `QUIZ${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 2,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const userId = randomUUID();
      for (const id of [userId, `${userId}-other`]) {
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
      }
      await body(trx, {
        userId,
        otherUser: `${userId}-other`,
        itemId: main.itemId,
        intro,
        raft,
        q,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

function served(got: QuizQuestion | "over" | null): QuizQuestion {
  if (got === null || got === "over") throw new Error(`expected a question`);
  return got;
}

test("a moment's sprint serves its own questions, then the same concepts, never twice", async () => {
  await inRollback(async (trx, { userId, itemId, raft, q }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    expect(started.endsAt.getTime()).toBeGreaterThan(Date.now() + 55_000);
    const stems: string[] = [];
    for (;;) {
      const got = await quizzes.next(userId, started.attemptId);
      if (got === "over") break;
      const one = served(got);
      // The key never leaves the server before the answer.
      expect(Object.keys(one).sort()).toEqual(
        ["options", "questionId", "servedAt", "stem"].sort(),
      );
      // Until it's answered, the same question comes back.
      expect(served(await quizzes.next(userId, started.attemptId))).toEqual(
        one,
      );
      stems.push(one.stem);
      await quizzes.answer(userId, started.attemptId, one.questionId, 1);
    }
    // Its own first, in order; then live questions on its concepts; never pending,
    // rejected, a retired concept's, or one its source no longer allows (ING-2).
    expect(stems).toEqual(["raft-0", "raft-1", "elsewhere"]);
    // The switched-off source's question still exists; only the filter kept it out.
    const hidden = await trx
      .selectFrom("question")
      .select("status")
      .where("id", "=", q["hidden"] ?? "0")
      .executeTakeFirst();
    expect(hidden?.status).toBe("live");
  });
});

test("an article's sprint covers all its moments' questions", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, null);
    if (started === null) throw new Error("no quiz");
    const stems: string[] = [];
    for (;;) {
      const got = await quizzes.next(userId, started.attemptId);
      if (got === "over") break;
      stems.push(served(got).stem);
      await quizzes.answer(
        userId,
        started.attemptId,
        served(got).questionId,
        0,
      );
    }
    expect(stems.slice(0, 3)).toEqual(["intro-0", "raft-0", "raft-1"]);
    expect(stems).toContain("elsewhere");
    expect(stems).toHaveLength(4);
  });
});

test("no quiz without a live question its source allows", async () => {
  await inRollback(async (trx, { userId, itemId, intro, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    await trx
      .updateTable("question")
      .set({ status: "retired" })
      .where("moment_id", "=", intro)
      .execute();
    expect(await quizzes.start(userId, itemId, intro)).toBeNull();
    // A moment that isn't the article's.
    expect(await quizzes.start(userId, "999999999999", raft)).toBeNull();
    await trx
      .updateTable("source")
      .set({ moments_switched_off: true, moments_enabled: false })
      .where(
        "id",
        "=",
        trx
          .selectFrom("content_item")
          .select("source_id")
          .where("id", "=", itemId),
      )
      .execute();
    expect(await quizzes.start(userId, itemId, raft)).toBeNull();
  });
});

test("a sprint whose source is switched off mid-way serves and takes nothing more", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const open = served(await quizzes.next(userId, started.attemptId));
    await trx
      .updateTable("source")
      .set({ moments_switched_off: true, moments_enabled: false })
      .where(
        "id",
        "=",
        trx
          .selectFrom("content_item")
          .select("source_id")
          .where("id", "=", itemId),
      )
      .execute();
    // The purge takes its moments, questions and the attempt with them (ING-2).
    expect(await quizzes.next(userId, started.attemptId)).toBeNull();
    expect(
      await quizzes.answer(userId, started.attemptId, open.questionId, 0),
    ).toBeNull();
  });
});

test("an answer is checked and counted once; a resubmit gets the stored result", async () => {
  await inRollback(async (trx, { userId, itemId, raft, q }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const first = served(await quizzes.next(userId, started.attemptId));
    const wrong = await quizzes.answer(
      userId,
      started.attemptId,
      first.questionId,
      2,
    );
    expect(wrong).toMatchObject({
      correct: false,
      correctOption: 0,
      firstTime: true,
    });
    const again = await quizzes.answer(
      userId,
      started.attemptId,
      first.questionId,
      0,
    );
    // LOAD-5: the same (attempt, question) is recorded once, as first answered.
    expect(again).toMatchObject({ correct: false, firstTime: false });
    const second = served(await quizzes.next(userId, started.attemptId));
    expect(
      await quizzes.answer(userId, started.attemptId, second.questionId, 0),
    ).toMatchObject({ correct: true, firstTime: true });
    const counts = await trx
      .selectFrom("question")
      .select(["id", "answer_count", "correct_count"])
      .where("id", "in", [first.questionId, second.questionId])
      .orderBy("id")
      .execute();
    expect(counts.map((c) => [c.answer_count, c.correct_count])).toEqual([
      [1, 0],
      [1, 1],
    ]);
    // A question not served in this attempt isn't answerable.
    expect(
      await quizzes.answer(userId, started.attemptId, q["intro-0"] ?? "", 0),
    ).toBeNull();
    // Served but unanswered when finished: not counted as answered.
    const unanswered = served(await quizzes.next(userId, started.attemptId));
    expect(await quizzes.finish(userId, started.attemptId)).toEqual({
      answered: 2,
      correct: 1,
      firstTime: true,
    });
    expect(await quizzes.finish(userId, started.attemptId)).toMatchObject({
      firstTime: false,
    });
    // Finished: nothing more is served or taken.
    expect(await quizzes.next(userId, started.attemptId)).toBe("over");
    expect(
      await quizzes.answer(userId, started.attemptId, unanswered.questionId, 0),
    ).toBe("late");
  });
});

test("a start while the sprint runs returns it; a finished one starts afresh", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const first = await quizzes.start(userId, itemId, raft);
    const again = await quizzes.start(userId, itemId, raft);
    expect(first?.firstTime).toBe(true);
    expect(again).toMatchObject({
      attemptId: first?.attemptId,
      firstTime: false,
    });
    // Another target is another sprint.
    expect((await quizzes.start(userId, itemId, null))?.firstTime).toBe(true);
    await quizzes.finish(userId, first?.attemptId ?? "0");
    const fresh = await quizzes.start(userId, itemId, raft);
    expect(fresh?.firstTime).toBe(true);
    expect(fresh?.attemptId).not.toBe(first?.attemptId);
  });
});

test("the clock: no answer or question after it ends and its grace", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const open = served(await quizzes.next(userId, started.attemptId));
    await trx
      .updateTable("quiz_attempt")
      .set({
        started_at: sql<Date>`now() - interval '2 minutes'`,
        ends_at: sql<Date>`now() - interval '1 minute'`,
      })
      .where("id", "=", started.attemptId)
      .execute();
    expect(
      await quizzes.answer(userId, started.attemptId, open.questionId, 0),
    ).toBe("late");
    expect(await quizzes.next(userId, started.attemptId)).toBe("over");
    const counts = await trx
      .selectFrom("question")
      .select("answer_count")
      .where("id", "=", open.questionId)
      .executeTakeFirstOrThrow();
    expect(counts.answer_count).toBe(0);
  });
});

test("the grace: a last answer just after the clock counts, nothing new is served", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const open = served(await quizzes.next(userId, started.attemptId));
    await trx
      .updateTable("quiz_attempt")
      .set({
        started_at: sql<Date>`now() - interval '63 seconds'`,
        ends_at: sql<Date>`now() - interval '3 seconds'`,
      })
      .where("id", "=", started.attemptId)
      .execute();
    expect(
      await quizzes.answer(userId, started.attemptId, open.questionId, 0),
    ).toMatchObject({ correct: true, firstTime: true });
    expect(await quizzes.next(userId, started.attemptId)).toBe("over");
  });
});

test("an attempt is its user's alone", async () => {
  await inRollback(async (trx, { userId, otherUser, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const open = served(await quizzes.next(userId, started.attemptId));
    expect(await quizzes.next(otherUser, started.attemptId)).toBeNull();
    expect(
      await quizzes.answer(otherUser, started.attemptId, open.questionId, 0),
    ).toBeNull();
    expect(await quizzes.finish(otherUser, started.attemptId)).toBeNull();
  });
});
