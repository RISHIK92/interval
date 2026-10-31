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
        .leftJoin("moment as m", "m.id", "q.moment_id")
        .leftJoin("content_item as c", "c.id", "m.content_item_id")
        .select([
          "q.id",
          "r.reason",
          "q.kind",
          "q.stem",
          "q.options",
          "q.correct",
          "q.validator_answer",
          "q.answer",
          "q.unit",
          "q.citation",
          sql<string>`coalesce(c.title, q.source_title)`.as("article_title"),
          "m.title as section_title",
          sql<string>`coalesce(m.link, q.source_url)`.as("link"),
        ])
        .where("r.decision", "is", null)
        .where("q.status", "in", ["live", "flagged"])
        // A book chapter's questions are its owner's private text, never an admin's.
        .where("q.book_chapter_id", "is", null)
        .orderBy("r.queued_at")
        .orderBy("q.id")
        .execute();
      return rows.map((r) => {
        const shared = {
          questionId: r.id,
          reason: r.reason,
          stem: r.stem,
          citation: r.citation,
          articleTitle: r.article_title,
          sectionTitle: r.section_title,
          link: r.link,
        };
        // question_shape: a choice has options and a key, an estimate its answer.
        if (r.kind === "estimate" && r.answer !== null && r.unit !== null)
          return {
            ...shared,
            kind: "estimate",
            answer: r.answer,
            unit: r.unit,
          };
        if (r.kind === "choice" && r.options !== null && r.correct !== null)
          return {
            ...shared,
            kind: "choice",
            options: r.options,
            correct: r.correct,
            validatorAnswer: r.validator_answer,
          };
        throw new Error(`question ${r.id} breaks question_shape`);
      });
    },
    // One statement: saved only when every concept is a live one.
    writeEstimate: async (draft) => {
      const slugs = [...new Set(draft.concepts)];
      const { rows } = await sql<{ id: string }>`
        with c as (
          select id from concept where slug = any(${slugs}) and retired_at is null
        ),
        q as (
          insert into question (kind, ordinal, stem, answer, unit, citation,
            source_url, source_title, difficulty, status)
          select 'estimate', 0, ${draft.stem}, ${draft.answer}, ${draft.unit},
            ${draft.citation}, ${draft.sourceUrl}, ${draft.sourceTitle},
            ${draft.difficulty}::difficulty, 'live'
          where (select count(*) from c) = ${slugs.length}
          returning id
        ),
        qc as (
          insert into question_concept (question_id, concept_id)
          select q.id, c.id from q, c
        )
        select id from q
      `.execute(db);
      return rows[0]?.id ?? null;
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
