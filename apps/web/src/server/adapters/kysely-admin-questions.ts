import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { AdminQuestions } from "../ports";

// Q-2 (P2-W8-S03): the spot-check queue, read and decided by an admin.
export function kyselyAdminQuestions(db: Kysely<DB>): AdminQuestions {
  return {
    open: async () => {
      const rows = await db
        .selectFrom("question_review as r")
        .innerJoin("question as q", "q.id", "r.question_id")
        .innerJoin("moment as m", "m.id", "q.moment_id")
        .innerJoin("content_item as c", "c.id", "m.content_item_id")
        .select([
          "q.id",
          "r.reason",
          "q.stem",
          "q.options",
          "q.correct",
          "q.validator_answer",
          "q.citation",
          "c.title as article_title",
          "m.title as section_title",
          "m.link",
        ])
        .where("r.decision", "is", null)
        .where("q.status", "in", ["live", "flagged"])
        .orderBy("r.queued_at")
        .orderBy("q.id")
        .execute();
      return rows.map((r) => ({
        questionId: r.id,
        reason: r.reason,
        stem: r.stem,
        options: r.options,
        correct: r.correct,
        validatorAnswer: r.validator_answer,
        citation: r.citation,
        articleTitle: r.article_title,
        sectionTitle: r.section_title,
        link: r.link,
      }));
    },
    // One statement: the review is decided only if it was open, and the question
    // changes only with it.
    decide: async (questionId, decision, by) => {
      const result = await sql<{ id: string }>`
        with decided as (
          update question_review
          set decision = ${decision}::review_decision, decided_by = ${by},
              decided_at = now()
          where question_id = ${questionId} and decision is null
          returning question_id
        )
        update question q
        set status = (case
          when ${decision} = 'retire' then 'retired'
          when q.status = 'flagged' then 'live'
          else q.status::text
        end)::question_status
        from decided
        where q.id = decided.question_id
        returning q.id
      `.execute(db);
      return result.rows.length > 0;
    },
  };
}
