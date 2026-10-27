import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { type QuizQuestion, quizKey } from "../ports";
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
      stem: open.stem,
      options: open.options,
      chosen: 2,
      correctOption: 0,
      correct: false,
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
