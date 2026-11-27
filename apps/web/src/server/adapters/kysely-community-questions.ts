import type { DB, QuestionStatus } from "@interval/db";
import { type Kysely, type RawBuilder, sql } from "kysely";
import {
  type AdminCommunity,
  COMMUNITY_REJECTIONS,
  type CommunityQuestions,
  type CommunityState,
} from "../ports";

// Q-P7-05 (owner, 2026-11-27): community questions in the `question` table, told apart
// by submission_key (kept when the author leaves). Saved pending; the worker's second-model check sends one the
// model agrees with to the owner's queue (question_review, reason 'community').

// The section's live concepts, as `m`, as drafting tags its questions: an admin's
// correction replaces the model's tags (P1-W3-S05), and a retired concept is none.
const LIVE_CONCEPTS = sql`
  select c.id from concept c
  where c.retired_at is null and c.slug = any(coalesce(
    (select o.concepts from tag_override o
     where o.content_item_id = m.content_item_id
       and o.heading = m.title and m.link_type <> 'page_top'),
    array(select c2.slug from moment_concept mc
          join concept c2 on c2.id = mc.concept_id where mc.moment_id = m.id)
  ))
`;

// A section the user opened whose question the worker can check: the drafting
// targets' rules (ING-2: full text with moments on; no duplicate's; a live concept).
const sectionFor = (userId: string, momentId: string) => sql<{
  moment_id: string;
  title: string;
  article_title: string;
}>`
  select m.id as moment_id, m.title,
         ci.title as article_title
  from moment m
  join content_item ci on ci.id = m.content_item_id and ci.duplicate_of is null
  join source s on s.id = ci.source_id
   and s.moments_enabled
   and s.rights_profile in ('full_text_internal', 'full_text_display')
  where m.id = ${momentId}
    and exists (
      select 1 from user_moment_opened o
      where o.user_id = ${userId} and o.moment_id = m.id
    )
    and exists (${LIVE_CONCEPTS})
`;

// Where a player's own question stands. A retired one (W51's flags) reads as
// rejected in review.
function stateOf(
  status: QuestionStatus,
  validatedAt: Date | null,
  rejectedBecause: string | null,
): CommunityState {
  switch (status) {
    case "pending":
      return validatedAt === null ? "checking" : "reviewing";
    case "live":
    case "flagged":
      return "live";
    case "rejected":
    case "retired":
      return COMMUNITY_REJECTIONS.find((r) => r === rejectedBecause) ?? "owner";
  }
}

// Kysely can't nest transactions: inside one (as the tests run), use it.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

const submittedSince = (userId: string, since: Date): RawBuilder<number> =>
  sql<number>`(
    select count(*)::int from question
    where author_user_id = ${userId} and created_at >= ${since}
  )`;

export function kyselyCommunityQuestions(db: Kysely<DB>): CommunityQuestions {
  return {
    allowance: async (userId, since) => {
      const row = await db
        .selectFrom("app_user")
        .select(["email_verified", submittedSince(userId, since).as("used")])
        .where("id", "=", userId)
        .executeTakeFirst();
      return {
        verified: row?.email_verified ?? false,
        used: row?.used ?? 0,
      };
    },
    section: async (userId, momentId) => {
      const { rows } = await sectionFor(userId, momentId).execute(db);
      const row = rows[0];
      return row === undefined
        ? null
        : {
            momentId: row.moment_id,
            title: row.title,
            articleTitle: row.article_title,
          };
    },
    submit: (userId, draft, quota) =>
      inTransaction(db, async (trx) => {
        // One submission at a time per user (the daily count), then per section (its
        // next community slot); always in that order, so two can't deadlock.
        await sql`select pg_advisory_xact_lock(hashtext(${`community-user-${userId}`}))`.execute(
          trx,
        );
        const before = await trx
          .selectFrom("question")
          .select(["id", submittedSince(userId, quota.since).as("used")])
          .where("author_user_id", "=", userId)
          .where("submission_key", "=", draft.idempotencyKey)
          .executeTakeFirst();
        if (before !== undefined)
          return { id: before.id, created: false, used: before.used };
        const { rows: counted } = await sql<{
          used: number;
        }>`select ${submittedSince(userId, quota.since)} as used`.execute(trx);
        const used = counted[0]?.used ?? 0;
        if (quota.limit !== null && used >= quota.limit) return "daily_limit";
        await sql`select pg_advisory_xact_lock(hashtext(${`community-section-${draft.momentId}`}))`.execute(
          trx,
        );
        // Q-P2-11, as a drafted question: it starts at its section's level, an
        // admin's correction winning.
        const { rows } = await sql<{ id: string }>`
          with s as (${sectionFor(userId, draft.momentId)}),
          q as (
            insert into question (moment_id, ordinal, stem, options, correct,
              citation, difficulty, author_user_id, submission_key)
            select s.moment_id,
              (select coalesce(max(ordinal) + 1, 0) from question
               where moment_id = s.moment_id and submission_key is not null),
              ${draft.stem}, ${draft.options}::text[], ${draft.correct},
              ${draft.citation},
              (select coalesce(lo.difficulty, t.difficulty)
               from moment m
               left join moment_tagging t on t.moment_id = m.id
               left join tag_override lo
                 on lo.content_item_id = m.content_item_id
                and lo.heading = m.title and m.link_type <> 'page_top'
               where m.id = s.moment_id),
              ${userId}, ${draft.idempotencyKey}
            from s
            returning id, moment_id
          ),
          qc as (
            insert into question_concept (question_id, concept_id)
            select q.id, c.id from q
            join moment m on m.id = q.moment_id
            cross join lateral (${LIVE_CONCEPTS}) c
          )
          select id from q
        `.execute(trx);
        const saved = rows[0];
        return saved === undefined
          ? "no_section"
          : { id: saved.id, created: true, used: used + 1 };
      }),
    mine: async (userId, momentId) => {
      const rows = await db
        .selectFrom("question")
        .select(["id", "stem", "status", "validated_at", "rejected_because"])
        .where("author_user_id", "=", userId)
        .where("moment_id", "=", momentId)
        .where("submission_key", "is not", null)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .execute();
      return rows.map((r) => ({
        questionId: r.id,
        stem: r.stem,
        state: stateOf(r.status, r.validated_at, r.rejected_because),
      }));
    },
    drop: async (id) => {
      await db
        .deleteFrom("question")
        .where("id", "=", id)
        .where("submission_key", "is not", null)
        .execute();
    },
  };
}

// The owner's queue (Q-P7-05): reviews the second model's check opened. The author's
// username is the admin's to see; players never see it.
export function kyselyAdminCommunity(db: Kysely<DB>): AdminCommunity {
  return {
    open: async () => {
      const rows = await db
        .selectFrom("question_review as r")
        .innerJoin("question as q", "q.id", "r.question_id")
        .innerJoin("moment as m", "m.id", "q.moment_id")
        .innerJoin("content_item as c", "c.id", "m.content_item_id")
        .leftJoin("player_username as u", "u.user_id", "q.author_user_id")
        .select([
          "q.id",
          "q.stem",
          "q.options",
          "q.correct",
          "q.validator_answer",
          "q.citation",
          "q.created_at",
          "c.title as article_title",
          "m.title as section_title",
          "m.link",
          "u.username",
        ])
        .where("r.reason", "=", "community")
        .where("r.decision", "is", null)
        .where("q.status", "=", "pending")
        .where("q.submission_key", "is not", null)
        .orderBy("r.queued_at")
        .orderBy("q.id")
        .execute();
      return rows.map((r) => {
        // question_community and the check's verdict: a choice, validated.
        if (
          r.options === null ||
          r.correct === null ||
          r.validator_answer === null
        )
          throw new Error(
            `community question ${r.id} has no options or verdict`,
          );
        return {
          questionId: r.id,
          stem: r.stem,
          options: r.options,
          correct: r.correct,
          validatorAnswer: r.validator_answer,
          citation: r.citation,
          articleTitle: r.article_title,
          sectionTitle: r.section_title,
          link: r.link,
          author: r.username,
          submittedAt: r.created_at,
        };
      });
    },
    // One statement: the review is decided only while open on a pending community
    // question, and the question changes only with it.
    decide: async (questionId, decision, by) => {
      const result = await sql<{ id: string }>`
        with decided as (
          update question_review r
          set decision = ${decision}::review_decision, decided_by = ${by},
              decided_at = now()
          where r.question_id = ${questionId} and r.decision is null
            and r.reason = 'community'
            and exists (
              select 1 from question q
              where q.id = r.question_id and q.status = 'pending'
                and q.submission_key is not null
            )
          returning r.question_id
        )
        update question q
        set status = (case when ${decision} = 'approve' then 'live'
                      else 'rejected' end)::question_status,
            rejected_because = case when ${decision} = 'reject' then 'owner' end
        from decided
        where q.id = decided.question_id
        returning q.id
      `.execute(db);
      return result.rows.length > 0;
    },
  };
}
