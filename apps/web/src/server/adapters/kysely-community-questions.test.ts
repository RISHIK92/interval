import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { CommunityDraft } from "../ports";
import { createDb } from "./kysely";
import { kyselyAdminQuestions } from "./kysely-admin-questions";
import {
  kyselyAdminCommunity,
  kyselyCommunityQuestions,
} from "./kysely-community-questions";
import { kyselyQuizzes, LIVE } from "./kysely-quizzes";

// Q-P7-05 (owner, 2026-11-27): community questions in the question table. Written at
// the end of a section the player opened, on its live concepts; at most the daily
// count; the owner approves or rejects what the second model agreed with. Until W51's
// practice-only paths, a live one serves nowhere.
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
  author: string;
  other: string;
  itemId: string;
  momentId: string;
  conceptId: string;
};

async function inRollback(
  body: (trx: Transaction<DB>, seeded: Seeded) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const tag = randomUUID();
      const source = await trx
        .insertInto("source")
        .values({
          name: `community-${tag}`,
          feed_url: `https://community.example.test/${tag}.xml`,
          rights_profile: "full_text_internal",
          moments_seeded: true,
          moments_enabled: true,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const item = await trx
        .insertInto("content_item")
        .values({
          source_id: source.id,
          guid: tag,
          canonical_url: `https://community.example.test/${tag}`,
          title: "Consensus",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moment = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 0,
          title: "Raft",
          estimated_minutes: 3,
          link: `https://community.example.test/${tag}#raft`,
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("moment_tagging")
        .values({ moment_id: moment.id, difficulty: "intermediate" })
        .execute();
      const concept = await trx
        .insertInto("concept")
        .values({ slug: `raft-${tag}`, name: "Raft", topic: "databases" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("moment_concept")
        .values({ moment_id: moment.id, concept_id: concept.id })
        .execute();
      const author = randomUUID();
      const other = randomUUID();
      for (const id of [author, other])
        await trx
          .insertInto("app_user")
          .values({
            id,
            name: "n",
            email: `${id}@example.test`,
            email_verified: id === author,
          })
          .execute();
      await trx
        .insertInto("player_username")
        .values({ user_id: author, username: `w${tag.slice(0, 8)}` })
        .execute();
      await trx
        .insertInto("user_moment_opened")
        .values({ user_id: author, moment_id: moment.id })
        .execute();
      await body(trx, {
        author,
        other,
        itemId: item.id,
        momentId: moment.id,
        conceptId: concept.id,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

const draft = (
  momentId: string,
  key: string = randomUUID(),
): CommunityDraft => ({
  momentId,
  stem: "What does a Raft leader need to commit an entry?",
  options: ["Every vote", "A majority", "The longest log", "A lease"],
  correct: 1,
  citation: "an entry is committed once a majority has it",
  idempotencyKey: key,
});

const today = () => new Date(Date.now() - 60_000);
const unlimited = () => ({ since: today(), limit: null });

// What the worker's check does when the model agrees (record_community_verdict).
async function checked(trx: Transaction<DB>, id: string): Promise<void> {
  await sql`
    update question set validator_model = 'v', validator_answer = correct,
      validated_at = now()
    where id = ${id}`.execute(trx);
  await trx
    .insertInto("question_review")
    .values({ question_id: id, reason: "community" })
    .execute();
}

test("a section is one the player opened, its source allows, with a live concept", async () => {
  await inRollback(async (trx, { author, other, itemId, momentId }) => {
    const community = kyselyCommunityQuestions(trx);
    expect(await community.section(author, momentId)).toEqual({
      momentId,
      title: "Raft",
      articleTitle: "Consensus",
    });
    // Never opened by this player.
    expect(await community.section(other, momentId)).toBeNull();
    expect(await community.submit(other, draft(momentId), unlimited())).toBe(
      "no_section",
    );
    // ING-2: rights lowered, nothing to check it against.
    await sql`set local session_replication_role = replica`.execute(trx);
    await sql`
      update source set rights_profile = 'metadata_only'
      where id = (select source_id from content_item where id = ${itemId})`.execute(
      trx,
    );
    await sql`set local session_replication_role = origin`.execute(trx);
    expect(await community.section(author, momentId)).toBeNull();
  });
});

test("a submission is saved pending, by its author, on the section's concepts", async () => {
  await inRollback(async (trx, { author, momentId, conceptId }) => {
    const community = kyselyCommunityQuestions(trx);
    expect(await community.allowance(author, today())).toEqual({
      verified: true,
      used: 0,
    });
    const saved = await community.submit(author, draft(momentId), unlimited());
    if (typeof saved === "string") throw new Error(saved);
    expect(saved).toMatchObject({ created: true, used: 1 });
    const row = await trx
      .selectFrom("question")
      .selectAll()
      .where("id", "=", saved.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      moment_id: momentId,
      ordinal: 0,
      kind: "choice",
      status: "pending",
      stem: "What does a Raft leader need to commit an entry?",
      options: ["Every vote", "A majority", "The longest log", "A lease"],
      correct: 1,
      citation: "an entry is committed once a majority has it",
      author_user_id: author,
      generator_model: null,
      source_url: null,
      difficulty: "intermediate",
    });
    expect(
      await trx
        .selectFrom("question_concept")
        .select("concept_id")
        .where("question_id", "=", saved.id)
        .execute(),
    ).toEqual([{ concept_id: conceptId }]);
    // A second one takes the section's next community slot.
    const next = await community.submit(author, draft(momentId), unlimited());
    if (typeof next === "string") throw new Error(next);
    const ordinal = await trx
      .selectFrom("question")
      .select("ordinal")
      .where("id", "=", next.id)
      .executeTakeFirstOrThrow();
    expect(ordinal.ordinal).toBe(1);
    expect(await community.allowance(author, today())).toMatchObject({
      used: 2,
    });
  });
});

test("the same key is the same question, past the daily limit too (LOAD-5)", async () => {
  await inRollback(async (trx, { author, momentId }) => {
    const community = kyselyCommunityQuestions(trx);
    const quota = { since: today(), limit: 2 };
    const first = await community.submit(author, draft(momentId, "k1"), quota);
    if (typeof first === "string") throw new Error(first);
    await community.submit(author, draft(momentId, "k2"), quota);
    expect(await community.submit(author, draft(momentId, "k3"), quota)).toBe(
      "daily_limit",
    );
    expect(
      await community.submit(author, draft(momentId, "k1"), quota),
    ).toEqual({ id: first.id, created: false, used: 2 });
    // Yesterday's don't count today.
    expect(
      await community.submit(author, draft(momentId, "k3"), {
        since: new Date(Date.now() + 60_000),
        limit: 2,
      }),
    ).toMatchObject({ created: true });
    await community.drop(first.id);
    expect(
      await trx
        .selectFrom("question")
        .select("id")
        .where("id", "=", first.id)
        .execute(),
    ).toEqual([]);
  });
});

test("the owner's queue: what the check agreed with, Approve makes it live, Reject rejects", async () => {
  await inRollback(async (trx, { author, momentId }) => {
    const community = kyselyCommunityQuestions(trx);
    const admin = kyselyAdminCommunity(trx);
    const one = await community.submit(author, draft(momentId), unlimited());
    const two = await community.submit(author, draft(momentId), unlimited());
    if (typeof one === "string" || typeof two === "string")
      throw new Error("not saved");
    // Not checked yet: not the owner's.
    expect(await admin.open()).toEqual([]);
    await checked(trx, one.id);
    await checked(trx, two.id);
    const queue = await admin.open();
    expect(queue.map((q) => q.questionId)).toEqual([one.id, two.id]);
    expect(queue[0]).toMatchObject({
      stem: "What does a Raft leader need to commit an entry?",
      correct: 1,
      validatorAnswer: 1,
      citation: "an entry is committed once a majority has it",
      articleTitle: "Consensus",
      sectionTitle: "Raft",
      link: expect.stringContaining("#raft") as string,
      author: expect.stringMatching(/^w/) as string,
    });
    // The spot-check page's Keep or Retire can't decide it.
    expect(await kyselyAdminQuestions(trx).decide(one.id, "keep", author)).toBe(
      false,
    );
    expect(await admin.decide(one.id, "approve", author)).toBe(true);
    expect(await admin.decide(two.id, "reject", author)).toBe(true);
    expect(await admin.decide(one.id, "reject", author)).toBe(false);
    // The author sees where each stands (owner, 2026-11-27).
    const three = await community.submit(author, draft(momentId), unlimited());
    if (typeof three === "string") throw new Error(three);
    expect(
      (await community.mine(author, momentId)).map((q) => [
        q.questionId,
        q.state,
      ]),
    ).toEqual([
      [three.id, "checking"],
      [two.id, "owner"],
      [one.id, "live"],
    ]);
    const statuses = await trx
      .selectFrom("question")
      .select(["id", "status"])
      .where("id", "in", [one.id, two.id])
      .orderBy("id")
      .execute();
    expect(statuses).toEqual([
      { id: one.id, status: "live" },
      { id: two.id, status: "rejected" },
    ]);
    expect(await admin.open()).toEqual([]);
  });
});

// Until W51 adds the practice-only paths, an approved community question serves
// nowhere: LIVE (Test 60s, reviews, sprints, the daily challenge's rounds, live
// matches, ghosts and bots) and the daily challenge's pick leave it out.
test("a live community question is served by no quiz, review, match or daily pick", async () => {
  await inRollback(async (trx, { author, momentId, itemId, conceptId }) => {
    const saved = await kyselyCommunityQuestions(trx).submit(
      author,
      draft(momentId),
      unlimited(),
    );
    if (typeof saved === "string") throw new Error(saved);
    await checked(trx, saved.id);
    await kyselyAdminCommunity(trx).decide(saved.id, "approve", author);
    const { rows } = await sql<{ id: string }>`
      select q.id from ${LIVE} where q.status = 'live' and q.id = ${saved.id}
    `.execute(trx);
    expect(rows).toEqual([]);
    const quizzes = kyselyQuizzes(trx);
    expect(await quizzes.offered([{ itemId, momentId }])).toEqual(new Set());
    expect(await quizzes.start(author, itemId, momentId)).toBeNull();
    await trx
      .insertInto("concept_review")
      .values({
        user_id: author,
        concept_id: conceptId,
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
    expect(await quizzes.dueReviews(author)).toEqual([]);
    expect(await quizzes.startReview(author)).toBeNull();
    // The daily challenge's pick, with only this question live (rolled back).
    await sql`update question set status = 'retired'
      where status = 'live' and id <> ${saved.id}`.execute(trx);
    const { rows: fit } = await sql<{ id: string | null }>`
      select daily_challenge_fit('2099-01-01', 'choice', null) as id
    `.execute(trx);
    expect(fit).toEqual([{ id: null }]);
    // Owner, 2026-11-27: an author who leaves leaves the question, still a community
    // one, still served nowhere.
    await trx.deleteFrom("app_user").where("id", "=", author).execute();
    const kept = await trx
      .selectFrom("question")
      .select(["status", "author_user_id"])
      .where("id", "=", saved.id)
      .executeTakeFirstOrThrow();
    expect(kept).toEqual({ status: "live", author_user_id: null });
    const { rows: after } = await sql<{ id: string }>`
      select q.id from ${LIVE} where q.status = 'live' and q.id = ${saved.id}
    `.execute(trx);
    expect(after).toEqual([]);
    expect(await quizzes.offered([{ itemId, momentId }])).toEqual(new Set());
    // A drafted question in the same section is served as before.
    await trx
      .insertInto("question")
      .values({
        moment_id: momentId,
        ordinal: 0,
        stem: "Drafted?",
        options: ["right", "w1", "w2", "w3"],
        correct: 0,
        citation: "a b c",
        status: "live",
        generator_model: "m",
        prompt_version: 1,
        content_hash: "h",
      })
      .execute();
    expect(await quizzes.offered([{ itemId, momentId }])).toEqual(
      new Set([`${itemId}.${momentId}`]),
    );
  });
});
