import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { type QuizQuestion, quizKey } from "../ports";
import { createDb } from "./kysely";
import { kyselyAdminQuestions } from "./kysely-admin-questions";
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
  // An article whose source has moments switched off, its questions kept (ING-2).
  hidden: { itemId: string; momentId: string };
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
        hidden: { itemId: hidden.itemId, momentId: hiddenMoment },
        q,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

function served(
  got: QuizQuestion | "over" | null,
): Extract<QuizQuestion, { kind: "choice" }> {
  if (got === null || got === "over" || got.kind !== "choice")
    throw new Error(`expected a multiple-choice question`);
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
        ["kind", "options", "questionId", "servedAt", "stem"].sort(),
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
      checkpoint: null,
      sprint: false,
      estimation: null,
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

// P2-W9-S02: what the cards, the reader and the results page ask.
test("offered keys only targets with a live question their source allows", async () => {
  await inRollback(async (trx, { itemId, intro, raft, hidden }) => {
    const quizzes = kyselyQuizzes(trx);
    await trx
      .updateTable("question")
      .set({ status: "retired" })
      .where("moment_id", "=", intro)
      .execute();
    const got = await quizzes.offered([
      { itemId, momentId: raft },
      { itemId, momentId: intro },
      { itemId, momentId: null },
      // A moment of another article: not this one's.
      { itemId: "999999999999", momentId: raft },
      // Live questions, but its source no longer allows moments (ING-2).
      hidden,
      { itemId: hidden.itemId, momentId: null },
    ]);
    expect([...got].sort()).toEqual(
      [quizKey(itemId, raft), quizKey(itemId, null)].sort(),
    );
    expect(await quizzes.offered([])).toEqual(new Set());
  });
});

test("an attempt's summary: counts, time, and its concepts with the user's state", async () => {
  await inRollback(async (trx, { userId, otherUser, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const empty = await quizzes.attempt(userId, started.attemptId);
    expect(empty?.secondsLeft).toBeGreaterThan(55);
    expect(empty).toMatchObject({
      itemId,
      momentId: raft,
      title: "Raft",
      answered: 0,
      correct: 0,
      avgMs: null,
      finishedAt: null,
      concepts: [],
    });
    const one = served(await quizzes.next(userId, started.attemptId));
    await quizzes.answer(userId, started.attemptId, one.questionId, 0);
    const two = served(await quizzes.next(userId, started.attemptId));
    await quizzes.answer(userId, started.attemptId, two.questionId, 3);
    // Served, not answered: not counted, its concepts not listed.
    served(await quizzes.next(userId, started.attemptId));
    // The answers made the state (S03): right then wrong, 0.3 then 0.21.
    const got = await quizzes.attempt(userId, started.attemptId);
    expect(got).toMatchObject({ answered: 2, correct: 1 });
    expect(got?.avgMs).toBeGreaterThanOrEqual(0);
    // raft-0 also tests the retired concept: never shown.
    expect(got?.concepts).toEqual([{ name: "raft", state: "explored" }]);
    expect(await quizzes.attempt(otherUser, started.attemptId)).toBeNull();
  });
});

test("an article attempt is titled by the article", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, null);
    if (started === null) throw new Error("no quiz");
    expect((await quizzes.attempt(userId, started.attemptId))?.title).toBe(
      "Consensus",
    );
  });
});

test("feedback gives the key only once the question is answered", async () => {
  await inRollback(async (trx, { userId, otherUser, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const open = served(await quizzes.next(userId, started.attemptId));
    expect(
      await quizzes.answered(userId, started.attemptId, open.questionId),
    ).toBeNull();
    await quizzes.answer(userId, started.attemptId, open.questionId, 2);
    expect(
      await quizzes.answered(userId, started.attemptId, open.questionId),
    ).toEqual({
      kind: "choice",
      stem: open.stem,
      options: open.options,
      chosen: 2,
      correctOption: 0,
      correct: false,
      flagged: false,
    });
    expect(
      await quizzes.answered(otherUser, started.attemptId, open.questionId),
    ).toBeNull();
  });
});

// P2-W9-S03 (PER-2, Q-P2-15): each answer moves its concepts strongly.
async function mastery(trx: Transaction<DB>, userId: string) {
  const rows = await trx
    .selectFrom("concept_mastery as m")
    .innerJoin("concept as c", "c.id", "m.concept_id")
    .select(["c.name", "m.probability", "m.state", "m.evidence_count"])
    .where("m.user_id", "=", userId)
    .orderBy("c.name")
    .execute();
  return rows.map((r) => ({
    name: r.name,
    p: Math.round(r.probability * 1000) / 1000,
    state: r.state,
    evidence: r.evidence_count,
  }));
}

async function answerStem(
  quizzes: ReturnType<typeof kyselyQuizzes>,
  userId: string,
  attemptId: string,
  right: boolean,
): Promise<string> {
  const open = served(await quizzes.next(userId, attemptId));
  // The seeded key is always option 0.
  await quizzes.answer(userId, attemptId, open.questionId, right ? 0 : 1);
  return open.questionId;
}

test("right answers raise a concept to practiced; a wrong one brings it back", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    await answerStem(quizzes, userId, started.attemptId, true);
    // From nothing: 0.3. raft-0 also tests a retired concept: never credited.
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0.3, state: "explored", evidence: 1 },
    ]);
    await answerStem(quizzes, userId, started.attemptId, true);
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0.51, state: "practiced", evidence: 2 },
    ]);
    await answerStem(quizzes, userId, started.attemptId, false);
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0.357, state: "explored", evidence: 3 },
    ]);
  });
});

test("mastered takes p ≥ 0.85 and right answers on two days", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const raftConcept = await trx
      .selectFrom("concept")
      .select("id")
      .where("name", "=", "raft")
      .where("slug", "like", "raft-%")
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("concept_mastery")
      .values({
        user_id: userId,
        concept_id: raftConcept.id,
        probability: 0.8,
        state: "practiced",
        evidence_count: 4,
      })
      .execute();
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const first = await answerStem(quizzes, userId, started.attemptId, true);
    // 0.86, but every right answer so far is from today.
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0.86, state: "practiced", evidence: 5 },
    ]);
    await trx
      .updateTable("quiz_answer")
      .set({
        served_at: sql<Date>`served_at - interval '1 day'`,
        answered_at: sql<Date>`answered_at - interval '1 day'`,
      })
      .where("attempt_id", "=", started.attemptId)
      .where("question_id", "=", first)
      .execute();
    await answerStem(quizzes, userId, started.attemptId, true);
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0.902, state: "mastered", evidence: 6 },
    ]);
    // The state follows p down as well.
    await answerStem(quizzes, userId, started.attemptId, false);
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0.631, state: "practiced", evidence: 7 },
    ]);
  });
});

test("a resubmitted or late answer credits nothing", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const first = await answerStem(quizzes, userId, started.attemptId, true);
    await quizzes.answer(userId, started.attemptId, first, 0);
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0.3, state: "explored", evidence: 1 },
    ]);
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
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0.3, state: "explored", evidence: 1 },
    ]);
  });
});

test("two right answers on the same day are one day, not mastery", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const raftConcept = await trx
      .selectFrom("concept")
      .select("id")
      .where("name", "=", "raft")
      .where("slug", "like", "raft-%")
      .orderBy("id", "desc")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("concept_mastery")
      .values({
        user_id: userId,
        concept_id: raftConcept.id,
        probability: 0.8,
        state: "practiced",
        evidence_count: 4,
      })
      .execute();
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    await answerStem(quizzes, userId, started.attemptId, true);
    await answerStem(quizzes, userId, started.attemptId, true);
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0.902, state: "practiced", evidence: 6 },
    ]);
  });
});

test("a wrong first answer is evidence: explored at p = 0 (owner, 2026-10-28)", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    await answerStem(quizzes, userId, started.attemptId, false);
    expect(await mastery(trx, userId)).toEqual([
      { name: "raft", p: 0, state: "explored", evidence: 1 },
    ]);
  });
});

// P2-W9-S04 (PER-2, Q-P2-16): finishing a quiz rates each concept it tested, once.
async function cards(trx: Transaction<DB>, userId: string) {
  const rows = await trx
    .selectFrom("concept_review as r")
    .innerJoin("concept as c", "c.id", "r.concept_id")
    .select(["c.name", "r.reps", "r.lapses", "r.due", "r.last_review"])
    .where("r.user_id", "=", userId)
    .orderBy("c.name")
    .execute();
  return rows.map((r) => ({
    name: r.name,
    reps: r.reps,
    lapses: r.lapses,
    days: Math.round((r.due.getTime() - r.last_review.getTime()) / 86_400_000),
  }));
}

test("a finished quiz rates each concept once: any wrong answer is Again", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const right = await quizzes.start(userId, itemId, raft);
    if (right === null) throw new Error("no quiz");
    await answerStem(quizzes, userId, right.attemptId, true);
    await answerStem(quizzes, userId, right.attemptId, true);
    served(await quizzes.next(userId, right.attemptId));
    expect(await cards(trx, userId)).toEqual([]);
    await quizzes.finish(userId, right.attemptId);
    const good = await cards(trx, userId);
    // The retired concept raft-0 also tests gets no card.
    expect(good.map((c) => [c.name, c.reps, c.lapses])).toEqual([
      ["raft", 1, 0],
    ]);
    expect(good[0]?.days).toBeGreaterThanOrEqual(1);
    // Finishing again rates nothing more.
    await quizzes.finish(userId, right.attemptId);
    expect((await cards(trx, userId))[0]?.reps).toBe(1);
  });
});

test("a quiz with a wrong answer schedules the concept sooner", async () => {
  await inRollback(async (trx, { userId, otherUser, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    for (const [user, wrong] of [
      [userId, false],
      [otherUser, true],
    ] as const) {
      const started = await quizzes.start(user, itemId, raft);
      if (started === null) throw new Error("no quiz");
      await answerStem(quizzes, user, started.attemptId, true);
      await answerStem(quizzes, user, started.attemptId, !wrong);
      await quizzes.finish(user, started.attemptId);
    }
    const [good] = await cards(trx, userId);
    const [again] = await cards(trx, otherUser);
    expect(again?.days).toBeLessThan(good?.days ?? 0);
  });
});

test("an attempt never finished rates nothing", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    await answerStem(quizzes, userId, started.attemptId, true);
    expect(await cards(trx, userId)).toEqual([]);
  });
});

test("a second quiz re-rates the same card: reps 2, and a wrong answer is a lapse", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const first = await quizzes.start(userId, itemId, raft);
    if (first === null) throw new Error("no quiz");
    await answerStem(quizzes, userId, first.attemptId, true);
    await quizzes.finish(userId, first.attemptId);
    const [before] = await trx
      .selectFrom("concept_review")
      .select(["stability", "difficulty", "state", "due"])
      .where("user_id", "=", userId)
      .execute();
    // Rated again as if at its due date, so the read-back fields all matter.
    await trx
      .updateTable("concept_review")
      .set({
        last_review: sql<Date>`last_review - interval '3 days'`,
        due: sql<Date>`now() - interval '1 minute'`,
      })
      .where("user_id", "=", userId)
      .execute();
    const second = await quizzes.start(userId, itemId, raft);
    if (second === null) throw new Error("no quiz");
    await answerStem(quizzes, userId, second.attemptId, false);
    await quizzes.finish(userId, second.attemptId);
    const [after] = await cards(trx, userId);
    expect([after?.reps, after?.lapses]).toEqual([2, 1]);
    const [row] = await trx
      .selectFrom("concept_review")
      .select(["stability", "difficulty", "state"])
      .where("user_id", "=", userId)
      .execute();
    // A lapse: less stable and harder; with short-term steps off it stays in review.
    expect(row?.stability).toBeLessThan(before?.stability ?? 0);
    expect(row?.difficulty).toBeGreaterThan(before?.difficulty ?? 0);
    expect(row?.state).toBe(before?.state);
  });
});

// The start actions close what's left open first (P2-W10-S06), as these do.
test("a quiz left running past its clock is rated when the user next starts one", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const left = await quizzes.start(userId, itemId, raft);
    if (left === null) throw new Error("no quiz");
    await answerStem(quizzes, userId, left.attemptId, true);
    await trx
      .updateTable("quiz_attempt")
      .set({
        started_at: sql<Date>`now() - interval '10 minutes'`,
        ends_at: sql<Date>`now() - interval '9 minutes'`,
      })
      .where("id", "=", left.attemptId)
      .execute();
    expect(await cards(trx, userId)).toEqual([]);
    await quizzes.closeStale(userId);
    await quizzes.start(userId, itemId, null);
    expect((await cards(trx, userId)).map((c) => c.reps)).toEqual([1]);
    const closed = await trx
      .selectFrom("quiz_attempt")
      .select(["finished_at", "ends_at"])
      .where("id", "=", left.attemptId)
      .executeTakeFirstOrThrow();
    // Closed at its own end, not when it was noticed.
    expect(closed.finished_at).toEqual(closed.ends_at);
  });
});

// P2-W9-S05 (Q-P2-17): review sessions over the concepts that have come due.
async function hiddenQuestion(
  trx: Transaction<DB>,
  momentId: string,
): Promise<string> {
  const row = await trx
    .selectFrom("question")
    .select("id")
    .where("moment_id", "=", momentId)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function cardFor(
  trx: Transaction<DB>,
  userId: string,
  name: string,
  due: string,
) {
  const concept = await trx
    .selectFrom("concept")
    .select("id")
    .where("name", "=", name)
    .orderBy("id", "desc")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("concept_review")
    .values({
      user_id: userId,
      concept_id: concept.id,
      due: sql<Date>`now() + ${sql.raw(`interval '${due}'`)}`,
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
}

test("due reviews: concepts past due with a live question, most overdue first", async () => {
  await inRollback(async (trx, { userId }) => {
    const quizzes = kyselyQuizzes(trx);
    expect(await quizzes.dueReviews(userId)).toEqual([]);
    await cardFor(trx, userId, "wal", "-1 hour");
    await cardFor(trx, userId, "raft", "-2 days");
    // A retired concept never comes due.
    await cardFor(trx, userId, "old", "-3 days");
    expect((await quizzes.dueReviews(userId)).map((d) => d.name)).toEqual([
      "raft",
      "wal",
    ]);
    // Whole days since the last recall, for the feed's review card.
    expect((await quizzes.dueReviews(userId)).map((d) => d.daysSince)).toEqual([
      3, 3,
    ]);
    // Not due yet.
    await trx
      .updateTable("concept_review")
      .set({ due: sql<Date>`now() + interval '1 day'` })
      .where("user_id", "=", userId)
      .execute();
    expect(await quizzes.dueReviews(userId)).toEqual([]);
  });
});

test("a review asks one question per due concept, untimed, then rates them", async () => {
  await inRollback(async (trx, { userId }) => {
    const quizzes = kyselyQuizzes(trx);
    expect(await quizzes.startReview(userId)).toBeNull();
    await cardFor(trx, userId, "wal", "-1 hour");
    await cardFor(trx, userId, "raft", "-2 days");
    const started = await quizzes.startReview(userId);
    expect(started).toMatchObject({ concepts: 2, firstTime: true });
    if (started === null) throw new Error("no review");
    // A second tap continues the same session.
    expect(await quizzes.startReview(userId)).toMatchObject({
      attemptId: started.attemptId,
      firstTime: false,
    });
    const attempt = await quizzes.attempt(userId, started.attemptId);
    expect(attempt).toMatchObject({
      review: true,
      itemId: null,
      endsAt: null,
      secondsLeft: null,
      title: "Review",
    });
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
    // Most overdue first: one raft question, then wal's only one.
    expect(stems).toHaveLength(2);
    expect(["raft-0", "raft-1", "elsewhere"]).toContain(stems[0]);
    expect(stems[1]).toBe("intro-0");
    // The answers moved mastery (S03); the finish rates the cards (S04).
    expect((await mastery(trx, userId)).map((m) => m.name)).toEqual([
      "raft",
      "wal",
    ]);
    await quizzes.finish(userId, started.attemptId);
    expect((await cards(trx, userId)).map((c) => [c.name, c.reps])).toEqual([
      ["raft", 2],
      ["wal", 2],
    ]);
    // Rated: nothing is due now.
    expect(await quizzes.dueReviews(userId)).toEqual([]);
  });
});

test("a due concept with nothing to ask (or only what its rights forbid) waits", async () => {
  await inRollback(async (trx, { userId, hidden }) => {
    const quizzes = kyselyQuizzes(trx);
    const [lonely, forbidden] = await trx
      .insertInto("concept")
      .values(
        ["lonely", "forbidden"].map((name) => ({
          slug: `${name}-${randomUUID()}`,
          name,
          topic: "distributed-systems",
        })),
      )
      .returning("id")
      .execute();
    if (!lonely || !forbidden) throw new Error("seed");
    // Its only question sits in a source whose moments are switched off (ING-2).
    await trx
      .insertInto("question_concept")
      .values({
        question_id: await hiddenQuestion(trx, hidden.momentId),
        concept_id: forbidden.id,
      })
      .execute();
    await cardFor(trx, userId, "lonely", "-1 day");
    await cardFor(trx, userId, "forbidden", "-1 day");
    expect(await quizzes.dueReviews(userId)).toEqual([]);
    expect(await quizzes.startReview(userId)).toBeNull();
  });
});

test("a question on two due concepts covers both; a concept left with nothing is passed over", async () => {
  await inRollback(async (trx, { userId, raft, q }) => {
    const quizzes = kyselyQuizzes(trx);
    const [a, b, gone] = await trx
      .insertInto("concept")
      .values(
        ["pair-a", "pair-b", "gone"].map((name) => ({
          slug: `${name}-${randomUUID()}`,
          name,
          topic: "distributed-systems",
        })),
      )
      .returning("id")
      .execute();
    if (!a || !b || !gone) throw new Error("seed");
    await question(trx, raft, 20, "both", [a.id, b.id]);
    const goneQuestion = await question(trx, raft, 21, "soon-gone", [gone.id]);
    await cardFor(trx, userId, "pair-a", "-3 days");
    await cardFor(trx, userId, "pair-b", "-2 days");
    await cardFor(trx, userId, "gone", "-1 day");
    const started = await quizzes.startReview(userId);
    if (started === null) throw new Error("no review");
    expect(started.concepts).toBe(3);
    // Its only question is retired mid-session.
    await trx
      .updateTable("question")
      .set({ status: "retired" })
      .where("id", "=", goneQuestion)
      .execute();
    const first = served(await quizzes.next(userId, started.attemptId));
    expect(first.stem).toBe("both");
    await quizzes.answer(userId, started.attemptId, first.questionId, 0);
    expect(await quizzes.next(userId, started.attemptId)).toBe("over");
    await quizzes.finish(userId, started.attemptId);
    expect((await cards(trx, userId)).map((c) => [c.name, c.reps])).toEqual([
      ["gone", 1],
      ["pair-a", 2],
      ["pair-b", 2],
    ]);
    expect(q["raft-0"]).toBeDefined();
  });
});

test("a review has no clock: an answer minutes in still counts", async () => {
  await inRollback(async (trx, { userId }) => {
    const quizzes = kyselyQuizzes(trx);
    await cardFor(trx, userId, "raft", "-1 day");
    const started = await quizzes.startReview(userId);
    if (started === null) throw new Error("no review");
    const open = served(await quizzes.next(userId, started.attemptId));
    await trx
      .updateTable("quiz_attempt")
      .set({ started_at: sql<Date>`now() - interval '5 minutes'` })
      .where("id", "=", started.attemptId)
      .execute();
    expect(
      await quizzes.answer(userId, started.attemptId, open.questionId, 0),
    ).toMatchObject({ correct: true, firstTime: true });
  });
});

test("a review left idle for 30 minutes is over: rated, and the next one is fresh", async () => {
  await inRollback(async (trx, { userId }) => {
    const quizzes = kyselyQuizzes(trx);
    await cardFor(trx, userId, "raft", "-1 day");
    const old = await quizzes.startReview(userId);
    if (old === null) throw new Error("no review");
    const open = served(await quizzes.next(userId, old.attemptId));
    await quizzes.answer(userId, old.attemptId, open.questionId, 0);
    await trx
      .updateTable("quiz_answer")
      .set({
        served_at: sql<Date>`served_at - interval '40 minutes'`,
        answered_at: sql<Date>`answered_at - interval '40 minutes'`,
      })
      .where("attempt_id", "=", old.attemptId)
      .execute();
    await trx
      .updateTable("quiz_attempt")
      .set({ started_at: sql<Date>`started_at - interval '41 minutes'` })
      .where("id", "=", old.attemptId)
      .execute();
    await cardFor(trx, userId, "wal", "-1 hour");
    await quizzes.closeStale(userId);
    const fresh = await quizzes.startReview(userId);
    expect(fresh?.attemptId).not.toBe(old.attemptId);
    expect(fresh?.concepts).toBe(1);
    // The old one was closed at its last answer and rated.
    const closed = await trx
      .selectFrom("quiz_attempt")
      .select("finished_at")
      .where("id", "=", old.attemptId)
      .executeTakeFirstOrThrow();
    expect(closed.finished_at).not.toBeNull();
    expect(
      (await cards(trx, userId)).find((c) => c.name === "raft")?.reps,
    ).toBe(2);
  });
});

test("a review a double tap meets is the same one", async () => {
  await inRollback(async (trx, { userId }) => {
    const quizzes = kyselyQuizzes(trx);
    await cardFor(trx, userId, "raft", "-1 day");
    const [one, two] = await Promise.all([
      quizzes.startReview(userId),
      quizzes.startReview(userId),
    ]);
    expect(one?.attemptId).toBe(two?.attemptId);
  });
});

test("a review takes at most 10 concepts", async () => {
  await inRollback(async (trx, { userId, raft }) => {
    const concepts = await trx
      .insertInto("concept")
      .values(
        Array.from({ length: 12 }, (_, i) => ({
          slug: `many-${String(i)}-${randomUUID()}`,
          name: `many-${String(i).padStart(2, "0")}`,
          topic: "distributed-systems",
        })),
      )
      .returning(["id", "name"])
      .execute();
    for (const [i, c] of concepts.entries()) {
      const q = await question(trx, raft, 10 + i, `many-q-${String(i)}`, [
        c.id,
      ]);
      expect(q).toBeTruthy();
      await cardFor(trx, userId, c.name, `-${String(20 - i)} hours`);
    }
    const due = await kyselyQuizzes(trx).dueReviews(userId);
    expect(due.map((d) => d.name)).toEqual(
      concepts.slice(0, 10).map((c) => c.name),
    );
  });
});

// P2-W9-S07 (Q-2, Q-P2-18): flagging an answered question.
test("a flag takes the question out of quizzes and into review, once per user", async () => {
  await inRollback(async (trx, { userId, otherUser, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const open = served(await quizzes.next(userId, started.attemptId));
    // Not answered yet: nothing to flag.
    expect(
      await quizzes.flag(userId, started.attemptId, open.questionId, "unclear"),
    ).toBe(false);
    await quizzes.answer(userId, started.attemptId, open.questionId, 1);
    // Not someone else's to flag through this attempt.
    expect(
      await quizzes.flag(
        otherUser,
        started.attemptId,
        open.questionId,
        "unclear",
      ),
    ).toBe(false);
    expect(
      await quizzes.flag(
        userId,
        started.attemptId,
        open.questionId,
        "wrong_key",
      ),
    ).toBe(true);
    expect(
      await quizzes.flag(userId, started.attemptId, open.questionId, "other"),
    ).toBe(false);
    const question = await trx
      .selectFrom("question")
      .select("status")
      .where("id", "=", open.questionId)
      .executeTakeFirstOrThrow();
    expect(question.status).toBe("flagged");
    const reviews = await trx
      .selectFrom("question_review")
      .select(["reason", "decision"])
      .where("question_id", "=", open.questionId)
      .execute();
    expect(reviews).toEqual([{ reason: "flagged", decision: null }]);
    expect(
      await quizzes.answered(userId, started.attemptId, open.questionId),
    ).toMatchObject({ flagged: true });
    // Out of quizzes: another user's sprint never serves it.
    const theirs = await quizzes.start(otherUser, itemId, raft);
    if (theirs === null) throw new Error("no quiz");
    const ids: string[] = [];
    for (;;) {
      const got = await quizzes.next(otherUser, theirs.attemptId);
      if (got === "over") break;
      ids.push(served(got).questionId);
      await quizzes.answer(
        otherUser,
        theirs.attemptId,
        served(got).questionId,
        0,
      );
    }
    expect(ids).not.toContain(open.questionId);
  });
});

test("an admin's Keep returns a flagged question; another user can flag it again", async () => {
  await inRollback(async (trx, { userId, otherUser, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const flagOnce = async (user: string) => {
      const started = await quizzes.start(user, itemId, raft);
      if (started === null) throw new Error("no quiz");
      const open = served(await quizzes.next(user, started.attemptId));
      await quizzes.answer(user, started.attemptId, open.questionId, 0);
      expect(
        await quizzes.flag(user, started.attemptId, open.questionId, "unclear"),
      ).toBe(true);
      return open.questionId;
    };
    const flagged = await flagOnce(userId);
    await kyselyAdminQuestions(trx).decide(flagged, "keep", userId);
    const back = await trx
      .selectFrom("question")
      .select("status")
      .where("id", "=", flagged)
      .executeTakeFirstOrThrow();
    expect(back.status).toBe("live");
    expect(await flagOnce(otherUser)).toBe(flagged);
    const reviews = await trx
      .selectFrom("question_review")
      .select(["reason", "decision"])
      .where("question_id", "=", flagged)
      .orderBy("id")
      .execute();
    expect(reviews).toEqual([
      { reason: "flagged", decision: "keep" },
      { reason: "flagged", decision: null },
    ]);
  });
});

test("a flag on a question in the sample turns its review into a flagged one", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const open = served(await quizzes.next(userId, started.attemptId));
    await quizzes.answer(userId, started.attemptId, open.questionId, 0);
    await trx
      .insertInto("question_review")
      .values({ question_id: open.questionId, reason: "sample" })
      .execute();
    await quizzes.flag(userId, started.attemptId, open.questionId, "unclear");
    const reviews = await trx
      .selectFrom("question_review")
      .select(["reason", "decision"])
      .where("question_id", "=", open.questionId)
      .execute();
    expect(reviews).toEqual([{ reason: "flagged", decision: null }]);
  });
});

test("a flag on a question retired meanwhile is kept but queues nothing", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const open = served(await quizzes.next(userId, started.attemptId));
    await quizzes.answer(userId, started.attemptId, open.questionId, 0);
    await trx
      .updateTable("question")
      .set({ status: "retired" })
      .where("id", "=", open.questionId)
      .execute();
    expect(
      await quizzes.flag(userId, started.attemptId, open.questionId, "other"),
    ).toBe(true);
    const reviews = await trx
      .selectFrom("question_review")
      .select("id")
      .where("question_id", "=", open.questionId)
      .execute();
    expect(reviews).toEqual([]);
  });
});

// P3-W13-S02 (§6.3, Q-P3-04): the solo 60-second sprint draws from the player's
// concepts, then their goals' concepts, then the whole bank, nearest their level, never
// a question they were served in the last 7 days.
async function conceptOf(trx: Transaction<DB>, questionId: string) {
  const row = await trx
    .selectFrom("question_concept as qc")
    .innerJoin("concept as c", "c.id", "qc.concept_id")
    .select(["c.id", "c.slug"])
    .where("qc.question_id", "=", questionId)
    .where("c.retired_at", "is", null)
    .executeTakeFirstOrThrow();
  return row;
}

async function explored(
  trx: Transaction<DB>,
  userId: string,
  conceptId: string,
) {
  await trx
    .insertInto("concept_mastery")
    .values({
      user_id: userId,
      concept_id: conceptId,
      probability: 0.1,
      state: "explored",
      evidence_count: 1,
    })
    .execute();
}

async function prefer(
  trx: Transaction<DB>,
  userId: string,
  level: "beginner" | "intermediate" | "advanced",
  goalSlugs: string[] = [],
) {
  await trx
    .insertInto("user_preferences")
    .values({
      user_id: userId,
      topics: sql`'{distributed-systems}'`,
      level,
      break_length: "3-8",
      // The local database curates concepts for the other goals; this one has none,
      // so the test's own goal concepts are the only ones.
      goals: sql`'{stay-sharp}'`,
    })
    .execute();
  for (const slug of goalSlugs)
    await trx
      .insertInto("goal_concept")
      .values({ goal: "stay-sharp", concept_slug: slug })
      .execute();
}

async function sprint(
  quizzes: ReturnType<typeof kyselyQuizzes>,
  userId: string,
): Promise<string> {
  const started = await quizzes.startSprint(userId);
  if (started === null) throw new Error("no sprint");
  return started.attemptId;
}

test("a sprint runs on a 60-second clock; a second start meets the running one", async () => {
  await inRollback(async (trx, { userId }) => {
    const quizzes = kyselyQuizzes(trx);
    const first = await quizzes.startSprint(userId);
    if (first === null) throw new Error("no sprint");
    expect(first.firstTime).toBe(true);
    const seconds = (first.endsAt.getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(55);
    expect(seconds).toBeLessThanOrEqual(61);
    expect(await quizzes.startSprint(userId)).toEqual({
      ...first,
      firstTime: false,
    });
    const attempt = await quizzes.attempt(userId, first.attemptId);
    expect(attempt).toMatchObject({
      sprint: true,
      review: false,
      itemId: null,
      title: "60-second sprint",
    });
  });
});

test("explored concepts first, then goal concepts, then the whole bank", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const raft = await conceptOf(trx, q["raft-1"] ?? "");
    await explored(trx, userId, wal.id);
    await prefer(trx, userId, "intermediate", [raft.slug]);
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await sprint(quizzes, userId);
    const stems: string[] = [];
    for (let i = 0; i < 5; i++) {
      const open = served(await quizzes.next(userId, attemptId));
      stems.push(open.stem);
      await quizzes.answer(userId, attemptId, open.questionId, 0);
    }
    // wal's one question, then raft's three (in any order), then the bank: never a
    // question its rights forbid or that isn't live.
    expect(stems[0]).toBe("intro-0");
    expect(stems.slice(1, 4).sort()).toEqual(["elsewhere", "raft-0", "raft-1"]);
    expect([
      "hidden",
      "pending",
      "rejected",
      ...stems.slice(0, 4),
    ]).not.toContain(stems[4]);
  });
});

test("nearest the player's level first", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const raft = await conceptOf(trx, q["raft-1"] ?? "");
    await explored(trx, userId, raft.id);
    await prefer(trx, userId, "intermediate");
    for (const [stem, difficulty] of [
      ["raft-0", "advanced"],
      ["raft-1", "intermediate"],
      ["elsewhere", "beginner"],
    ] as const)
      await trx
        .updateTable("question")
        .set({ difficulty })
        .where("id", "=", q[stem] ?? "")
        .execute();
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await sprint(quizzes, userId);
    expect(served(await quizzes.next(userId, attemptId)).stem).toBe("raft-1");
  });
});

test("a question served to the player in the last 7 days waits; an older one doesn't", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const raft = await conceptOf(trx, q["raft-1"] ?? "");
    await explored(trx, userId, raft.id);
    for (const [stem, days] of [
      ["raft-1", 3],
      ["raft-0", 8],
    ] as const) {
      const old = await trx
        .insertInto("quiz_attempt")
        .values({
          user_id: userId,
          sprint: true,
          started_at: sql<Date>`now() - make_interval(days => ${days})`,
          ends_at: sql<Date>`now() - make_interval(days => ${days}) + interval '60 seconds'`,
          finished_at: sql<Date>`now() - make_interval(days => ${days}) + interval '60 seconds'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("quiz_answer")
        .values({
          attempt_id: old.id,
          question_id: q[stem] ?? "",
          served_at: sql<Date>`now() - make_interval(days => ${days})`,
          chosen: 0,
          correct: true,
          answered_at: sql<Date>`now() - make_interval(days => ${days})`,
        })
        .execute();
    }
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await sprint(quizzes, userId);
    const stems: string[] = [];
    for (let i = 0; i < 2; i++) {
      const open = served(await quizzes.next(userId, attemptId));
      stems.push(open.stem);
      await quizzes.answer(userId, attemptId, open.questionId, 0);
    }
    expect(stems.sort()).toEqual(["elsewhere", "raft-0"]);
  });
});

test("the sprint's clock: after it and its grace, no answer counts and nothing is served", async () => {
  await inRollback(async (trx, { userId }) => {
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await sprint(quizzes, userId);
    const open = served(await quizzes.next(userId, attemptId));
    await trx
      .updateTable("quiz_attempt")
      .set({
        started_at: sql<Date>`now() - interval '2 minutes'`,
        ends_at: sql<Date>`now() - interval '1 minute'`,
      })
      .where("id", "=", attemptId)
      .execute();
    expect(await quizzes.answer(userId, attemptId, open.questionId, 0)).toBe(
      "late",
    );
    expect(await quizzes.next(userId, attemptId)).toBe("over");
  });
});

test("a sprint's answers are mastery evidence and its finish rates the concepts", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const raft = await conceptOf(trx, q["raft-1"] ?? "");
    await explored(trx, userId, raft.id);
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await sprint(quizzes, userId);
    await answerStem(quizzes, userId, attemptId, true);
    expect((await mastery(trx, userId))[0]).toMatchObject({
      name: "raft",
      evidence: 2,
    });
    expect(await quizzes.finish(userId, attemptId)).toMatchObject({
      answered: 1,
      correct: 1,
      firstTime: true,
      checkpoint: null,
    });
    expect((await cards(trx, userId)).length).toBeGreaterThan(0);
  });
});

test("a finished sprint lists the sections of its wrong answers, to read again", async () => {
  await inRollback(async (trx, { userId, q, raft, intro }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const raftConcept = await conceptOf(trx, q["raft-1"] ?? "");
    await explored(trx, userId, wal.id);
    await explored(trx, userId, raftConcept.id);
    // intro-0 at the player's level, so it comes first; raft's next (seeded keys).
    await prefer(trx, userId, "intermediate");
    await trx
      .updateTable("question")
      .set({ difficulty: "intermediate" })
      .where("id", "=", q["intro-0"] ?? "")
      .execute();
    await trx
      .updateTable("question")
      .set({ difficulty: "advanced" })
      .where("id", "in", [
        q["raft-0"] ?? "",
        q["raft-1"] ?? "",
        q["elsewhere"] ?? "",
      ])
      .execute();
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await sprint(quizzes, userId);
    // intro-0 first, answered wrong; then one of raft's, right.
    const wrong = served(await quizzes.next(userId, attemptId));
    expect(wrong.stem).toBe("intro-0");
    await quizzes.answer(userId, attemptId, wrong.questionId, 1);
    await answerStem(quizzes, userId, attemptId, true);
    await quizzes.finish(userId, attemptId);
    const attempt = await quizzes.attempt(userId, attemptId);
    expect(attempt?.missed).toEqual([
      expect.objectContaining({ momentId: intro, sectionTitle: "Intro" }),
    ]);
    expect(attempt?.missed.map((m) => m.momentId)).not.toContain(raft);
  });
});

test("a sprint has no target: the shape refuses one with an item", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    await expect(
      trx
        .insertInto("quiz_attempt")
        .values({
          user_id: userId,
          sprint: true,
          content_item_id: itemId,
          ends_at: sql<Date>`now() + interval '60 seconds'`,
        })
        .execute(),
    ).rejects.toThrow(/quiz_attempt_shape/);
  });
});

test("Read again leaves out sections whose source no longer allows them, or whose link broke", async () => {
  await inRollback(async (trx, { userId, q, intro, hidden }) => {
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await sprint(quizzes, userId);
    // Three wrong answers, as if served earlier: one readable, one on a source
    // switched off (ING-2), one on an article whose link has broken.
    for (const stem of ["intro-0", "hidden", "elsewhere"])
      await trx
        .insertInto("quiz_answer")
        .values({
          attempt_id: attemptId,
          question_id: q[stem] ?? "",
          chosen: 1,
          correct: false,
          answered_at: sql<Date>`now()`,
        })
        .execute();
    await trx
      .updateTable("content_item")
      .set({ link_broken_at: sql<Date>`now()` })
      .where(
        "id",
        "=",
        trx
          .selectFrom("question as qq")
          .innerJoin("moment as m", "m.id", "qq.moment_id")
          .select("m.content_item_id")
          .where("qq.id", "=", q["elsewhere"] ?? ""),
      )
      .execute();
    await quizzes.finish(userId, attemptId);
    const missed = (await quizzes.attempt(userId, attemptId))?.missed ?? [];
    expect(missed.map((m) => m.momentId)).toEqual([intro]);
    expect(missed.map((m) => m.momentId)).not.toContain(hidden.momentId);
  });
});

test("a player with no preferences (a guest) and questions without a difficulty still sprint", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const raft = await conceptOf(trx, q["raft-1"] ?? "");
    await explored(trx, userId, raft.id);
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await sprint(quizzes, userId);
    expect(["raft-0", "raft-1", "elsewhere"]).toContain(
      served(await quizzes.next(userId, attemptId)).stem,
    );
  });
});

// P3-W13-S03 (§6.3): estimation questions are answered with a number, so the
// multiple-choice quizzes (Test 60s, reviews, checkpoints, the sprint) never serve one.
async function estimates(
  trx: Transaction<DB>,
  momentId: string,
  conceptId: string,
): Promise<string[]> {
  const rows = await trx
    .insertInto("question")
    .values([
      {
        moment_id: momentId,
        ordinal: 5,
        kind: "estimate",
        stem: "drafted estimate",
        answer: 300,
        unit: "ms",
        citation: "a b c",
        generator_model: "m",
        prompt_version: 1,
        content_hash: "h",
        status: "live",
      },
      {
        ordinal: 0,
        kind: "estimate",
        stem: "hand-written estimate",
        answer: 10_000,
        unit: "requests per second",
        citation: "about ten thousand requests per second",
        source_url: "https://docs.example.test/limits",
        source_title: "Limits",
        status: "live",
      },
    ])
    .returning("id")
    .execute();
  await trx
    .insertInto("question_concept")
    .values(rows.map((r) => ({ question_id: r.id, concept_id: conceptId })))
    .execute();
  return ["drafted estimate", "hand-written estimate"];
}

test("no multiple-choice quiz serves an estimation question", async () => {
  await inRollback(async (trx, { userId, itemId, intro, q }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const left = await estimates(trx, intro, wal.id);
    const quizzes = kyselyQuizzes(trx);
    const stems = async (attemptId: string, most: number) => {
      const seen: string[] = [];
      for (let i = 0; i < most; i++) {
        const got = await quizzes.next(userId, attemptId);
        if (got === "over") break;
        seen.push(served(got).stem);
        await quizzes.answer(userId, attemptId, served(got).questionId, 0);
      }
      return seen;
    };
    // Test 60s on the moment: its one multiple-choice question, then over.
    const test60 = await quizzes.start(userId, itemId, intro);
    if (test60 === null) throw new Error("no quiz");
    expect(await stems(test60.attemptId, 5)).toEqual(["intro-0"]);
    await quizzes.finish(userId, test60.attemptId);
    // A review of wal: its multiple-choice question only.
    await trx
      .updateTable("concept_review")
      .set({ due: sql<Date>`now() - interval '1 hour'` })
      .where("user_id", "=", userId)
      .execute();
    const review = await quizzes.startReview(userId);
    if (review === null) throw new Error("no review");
    expect(await stems(review.attemptId, 5)).toEqual(["intro-0"]);
    await quizzes.finish(userId, review.attemptId);
    // The sprint: wal is explored now, so its estimates would come first.
    const attemptId = await sprint(quizzes, userId);
    const sprinted = await stems(attemptId, 5);
    expect(sprinted).toHaveLength(5);
    for (const stem of sprinted) expect(left).not.toContain(stem);
  });
});

// P3-W13-S04 (§6.3, C-27, owner 2026-10-31): a solo estimation round is a sprint over
// estimates: the same clock and pick, each answered with a number and scored 0 to 1,
// never mastery or review evidence.
async function handWritten(
  trx: Transaction<DB>,
  conceptId: string,
  stem: string,
  answer: number,
  status: "live" | "pending" | "retired" = "live",
): Promise<string> {
  const row = await trx
    .insertInto("question")
    .values({
      ordinal: 0,
      kind: "estimate",
      stem,
      answer,
      unit: "ms",
      citation: `about ${String(answer)} ms`,
      source_url: `https://docs.example.test/${stem}`,
      source_title: `Source of ${stem}`,
      status,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("question_concept")
    .values({ question_id: row.id, concept_id: conceptId })
    .execute();
  return row.id;
}

function estimate(
  got: QuizQuestion | "over" | null,
): Extract<QuizQuestion, { kind: "estimate" }> {
  if (got === null || got === "over" || got.kind !== "estimate")
    throw new Error(`expected an estimate`);
  return got;
}

async function round(
  quizzes: ReturnType<typeof kyselyQuizzes>,
  userId: string,
): Promise<string> {
  const started = await quizzes.startEstimation(userId);
  if (started === null) throw new Error("no round");
  return started.attemptId;
}

test("an estimation round needs a live estimate; it runs on the clock and a second start meets it", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const quizzes = kyselyQuizzes(trx);
    expect(await quizzes.startEstimation(userId)).toBeNull();
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    await handWritten(trx, wal.id, "pending one", 50, "pending");
    expect(await quizzes.startEstimation(userId)).toBeNull();
    await handWritten(trx, wal.id, "disk seek", 10);
    const first = await quizzes.startEstimation(userId);
    if (first === null) throw new Error("no round");
    expect(first.firstTime).toBe(true);
    const seconds = (first.endsAt.getTime() - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(55);
    expect(seconds).toBeLessThanOrEqual(61);
    expect(await quizzes.startEstimation(userId)).toEqual({
      ...first,
      firstTime: false,
    });
    // A sprint is its own game: it neither meets the round nor is met by it.
    const sprinted = await quizzes.startSprint(userId);
    expect(sprinted?.attemptId).not.toBe(first.attemptId);
    expect((await quizzes.startEstimation(userId))?.attemptId).toBe(
      first.attemptId,
    );
    expect(await quizzes.attempt(userId, first.attemptId)).toMatchObject({
      sprint: true,
      title: "Estimation",
      estimation: { points: 0, answers: [] },
    });
  });
});

test("a round serves live estimates in allowed moments and hand-written ones, explored concepts first", async () => {
  await inRollback(async (trx, { userId, q, intro, hidden }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const raft = await conceptOf(trx, q["raft-1"] ?? "");
    await explored(trx, userId, wal.id);
    await estimates(trx, intro, raft.id);
    await handWritten(trx, wal.id, "explored one", 10);
    await handWritten(trx, raft.id, "retired one", 10, "retired");
    // An estimate in a moment whose source has moments switched off (ING-2).
    await trx
      .insertInto("question")
      .values({
        moment_id: hidden.momentId,
        ordinal: 5,
        kind: "estimate",
        stem: "hidden estimate",
        answer: 1,
        unit: "ms",
        citation: "a b c",
        generator_model: "m",
        prompt_version: 1,
        content_hash: "h",
        status: "live",
      })
      .execute();
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await round(quizzes, userId);
    const stems: string[] = [];
    for (;;) {
      const got = await quizzes.next(userId, attemptId);
      if (got === "over") break;
      const open = estimate(got);
      stems.push(open.stem);
      await quizzes.answerEstimate(userId, attemptId, open.questionId, 1);
    }
    // P3-W13-S03b: a moment's estimate plays while its source allows moments (ING-2).
    expect(stems[0]).toBe("explored one");
    expect(stems.slice(1).sort()).toEqual([
      "drafted estimate",
      "hand-written estimate",
    ]);
  });
});

test("an estimate is scored by C-27 once; a resubmission gets the stored result", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const id = await handWritten(trx, wal.id, "disk seek", 300);
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await round(quizzes, userId);
    const open = estimate(await quizzes.next(userId, attemptId));
    expect(open).toMatchObject({ questionId: id, unit: "ms" });
    // A multiple-choice answer to an estimate does nothing.
    expect(await quizzes.answer(userId, attemptId, id, 0)).toBeNull();
    const got = await quizzes.answerEstimate(userId, attemptId, id, 900);
    expect(got).toMatchObject({ answer: 300, unit: "ms", firstTime: true });
    if (got === null || got === "late") throw new Error("no result");
    expect(got.score).toBeCloseTo(0.579, 3);
    expect(
      await quizzes.answerEstimate(userId, attemptId, id, 300),
    ).toMatchObject({ score: got.score, firstTime: false });
    expect(await quizzes.answered(userId, attemptId, id)).toEqual({
      kind: "estimate",
      questionId: id,
      stem: "disk seek",
      guess: 900,
      answer: 300,
      unit: "ms",
      score: got.score,
      source: {
        kind: "page",
        citation: "about 300 ms",
        title: "Source of disk seek",
        url: "https://docs.example.test/disk seek",
      },
      flagged: false,
    });
  });
});

// P3-W13-S03b (Q-P2-12, ING-2): a moment's estimate reveals its section, never the
// quote, and only while its source allows moments and its link works.
async function drafted(
  trx: Transaction<DB>,
  momentId: string,
  conceptId: string,
  ordinal = 0,
): Promise<string> {
  const row = await trx
    .insertInto("question")
    .values({
      moment_id: momentId,
      ordinal,
      kind: "estimate",
      stem: "replication lag",
      answer: 40,
      unit: "ms",
      citation: "a lag of 40 ms",
      generator_model: "m",
      prompt_version: 1,
      content_hash: "h",
      status: "live",
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await trx
    .insertInto("question_concept")
    .values({ question_id: row.id, concept_id: conceptId })
    .execute();
  return row.id;
}

test("a moment's estimate reveals its section without the quote, while its rights allow", async () => {
  await inRollback(async (trx, { userId, q, itemId, intro }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const id = await drafted(trx, intro, wal.id);
    const moment = await trx
      .selectFrom("moment")
      .select("title")
      .where("id", "=", intro)
      .executeTakeFirstOrThrow();
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await round(quizzes, userId);
    expect(estimate(await quizzes.next(userId, attemptId)).questionId).toBe(id);
    await quizzes.answerEstimate(userId, attemptId, id, 400);
    const section = {
      kind: "section",
      itemId,
      momentId: intro,
      sectionTitle: moment.title,
      frameable: false,
    };
    const answered = await quizzes.answered(userId, attemptId, id);
    expect(answered).toMatchObject({
      kind: "estimate",
      score: 0,
      source: section,
    });
    expect(JSON.stringify(answered)).not.toContain("a lag of 40 ms");
    // Its link breaks: the answer and its points stay, the link goes (ING-6).
    const itemRow = await trx
      .selectFrom("content_item")
      .select("source_id")
      .where("id", "=", itemId)
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("content_item")
      .set({ link_broken_at: sql<Date>`now()` })
      .where("id", "=", itemId)
      .execute();
    expect(await quizzes.answered(userId, attemptId, id)).toMatchObject({
      score: 0,
      source: null,
    });
    expect(
      (await quizzes.attempt(userId, attemptId))?.estimation,
    ).toMatchObject({
      points: 0,
      answers: [{ questionId: id, guess: 400, source: null }],
    });
    // A new round never serves an estimate from it: nothing to cite (AI-3).
    await quizzes.finish(userId, attemptId);
    await drafted(trx, intro, wal.id, 1);
    expect(await quizzes.startEstimation(userId)).toBeNull();
    await trx
      .updateTable("content_item")
      .set({ link_broken_at: null })
      .where("id", "=", itemId)
      .execute();
    // Its source switches moments off (ING-2): its moments are purged, and the
    // question and its answer with them, so nothing of it is shown.
    await trx
      .updateTable("source")
      .set({ moments_switched_off: true, moments_enabled: false })
      .where("id", "=", itemRow.source_id)
      .execute();
    expect(await quizzes.answered(userId, attemptId, id)).toBeNull();
    expect((await quizzes.attempt(userId, attemptId))?.estimation).toEqual({
      points: 0,
      answers: [],
    });
  });
});

test("a validated question keeps one validator answer of its own kind", async () => {
  await inRollback(async (trx, { q, intro }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const id = await drafted(trx, intro, wal.id);
    await expect(
      trx
        .updateTable("question")
        .set({
          validator_model: "v",
          validator_estimate: 40,
          validator_answer: 1,
          validated_at: sql<Date>`now()`,
        })
        .where("id", "=", id)
        .execute(),
    ).rejects.toThrow(/question_shape|question_validated_together/);
  });
});

test("a multiple-choice question never carries a validator's number", async () => {
  await inRollback(async (trx, { q }) => {
    await expect(
      trx
        .updateTable("question")
        .set({
          validator_model: "v",
          validator_answer: 0,
          validator_estimate: 3,
          validated_at: sql<Date>`now()`,
        })
        .where("id", "=", q["intro-0"] ?? "")
        .execute(),
    ).rejects.toThrow(
      /question_validator_estimate_shape|question_validated_together/,
    );
  });
});

test("an estimate's verdict needs its validator's number", async () => {
  await inRollback(async (trx, { q, intro }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const id = await drafted(trx, intro, wal.id);
    await expect(
      trx
        .updateTable("question")
        .set({ validator_model: "v", validated_at: sql<Date>`now()` })
        .where("id", "=", id)
        .execute(),
    ).rejects.toThrow(/question_validated_together/);
  });
});

test("an estimate answer to a multiple-choice question does nothing", async () => {
  await inRollback(async (trx, { userId, itemId, raft }) => {
    const quizzes = kyselyQuizzes(trx);
    const started = await quizzes.start(userId, itemId, raft);
    if (started === null) throw new Error("no quiz");
    const open = served(await quizzes.next(userId, started.attemptId));
    expect(
      await quizzes.answerEstimate(
        userId,
        started.attemptId,
        open.questionId,
        5,
      ),
    ).toBeNull();
  });
});

test("after the round's clock and its grace, an estimate doesn't count", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    await handWritten(trx, wal.id, "disk seek", 300);
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await round(quizzes, userId);
    const open = estimate(await quizzes.next(userId, attemptId));
    await trx
      .updateTable("quiz_attempt")
      .set({
        started_at: sql<Date>`now() - interval '2 minutes'`,
        ends_at: sql<Date>`now() - interval '1 minute'`,
      })
      .where("id", "=", attemptId)
      .execute();
    expect(
      await quizzes.answerEstimate(userId, attemptId, open.questionId, 300),
    ).toBe("late");
    expect(await quizzes.next(userId, attemptId)).toBe("over");
  });
});

test("a round is a game score only: no mastery, no review card, no answer counts", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const near = await handWritten(trx, wal.id, "near", 300);
    const far = await handWritten(trx, wal.id, "far", 300);
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await round(quizzes, userId);
    for (let i = 0; i < 2; i++) {
      const open = estimate(await quizzes.next(userId, attemptId));
      await quizzes.answerEstimate(
        userId,
        attemptId,
        open.questionId,
        open.questionId === near ? 310 : 9000,
      );
    }
    expect(await quizzes.finish(userId, attemptId)).toEqual({
      answered: 2,
      correct: 1,
      firstTime: true,
      checkpoint: null,
      sprint: true,
      estimation: { points: 100 },
    });
    expect(await mastery(trx, userId)).toEqual([]);
    expect(await cards(trx, userId)).toEqual([]);
    const counts = await trx
      .selectFrom("question")
      .select(["answer_count", "correct_count"])
      .where("id", "in", [near, far])
      .execute();
    expect(counts).toEqual([
      { answer_count: 0, correct_count: 0 },
      { answer_count: 0, correct_count: 0 },
    ]);
    const attempt = await quizzes.attempt(userId, attemptId);
    expect(attempt).toMatchObject({ answered: 2, correct: 1, concepts: [] });
    expect(attempt?.estimation?.points).toBe(100);
    expect(
      attempt?.estimation?.answers.map((a) => [a.stem, a.guess, a.score]),
    ).toEqual(
      expect.arrayContaining([
        ["near", 310, 1],
        ["far", 9000, 0],
      ]),
    );
    // closeStale treats a round like a sprint: it has nothing left to close.
    expect(await quizzes.closeStale(userId)).toEqual([]);
  });
});

test("a flagged hand-written estimate leaves rounds and is queued for review at once", async () => {
  await inRollback(async (trx, { userId, otherUser, q }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    const id = await handWritten(trx, wal.id, "disk seek", 300);
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await round(quizzes, userId);
    estimate(await quizzes.next(userId, attemptId));
    await quizzes.answerEstimate(userId, attemptId, id, 300);
    expect(await quizzes.flag(userId, attemptId, id, "wrong_key")).toBe(true);
    const question = await trx
      .selectFrom("question")
      .select("status")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(question.status).toBe("flagged");
    expect(
      await trx
        .selectFrom("question_review")
        .select(["reason", "decision"])
        .where("question_id", "=", id)
        .execute(),
    ).toEqual([{ reason: "flagged", decision: null }]);
    expect(await quizzes.startEstimation(otherUser)).toBeNull();
  });
});

test("an answer is a choice or an estimate, never both", async () => {
  await inRollback(async (trx, { userId, q }) => {
    const wal = await conceptOf(trx, q["intro-0"] ?? "");
    await handWritten(trx, wal.id, "disk seek", 300);
    const quizzes = kyselyQuizzes(trx);
    const attemptId = await round(quizzes, userId);
    const open = estimate(await quizzes.next(userId, attemptId));
    await expect(
      trx
        .updateTable("quiz_answer")
        .set({
          chosen: 0,
          correct: true,
          guess: 3,
          score: 0,
          answered_at: sql<Date>`now()`,
        })
        .where("attempt_id", "=", attemptId)
        .where("question_id", "=", open.questionId)
        .execute(),
    ).rejects.toThrow(/quiz_answer_answered/);
  });
});

test("an estimation round is always a sprint", async () => {
  await inRollback(async (trx, { userId, itemId }) => {
    await expect(
      trx
        .insertInto("quiz_attempt")
        .values({
          user_id: userId,
          estimation: true,
          ends_at: sql<Date>`now() + interval '60 seconds'`,
          content_item_id: itemId,
        })
        .execute(),
    ).rejects.toThrow(/quiz_attempt_estimation_is_sprint/);
  });
});
