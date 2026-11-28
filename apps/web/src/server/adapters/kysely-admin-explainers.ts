import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { AdminExplainers, ExplainerReview } from "../ports";
import { citedArticles } from "./explainer-citations";

// P4-W22-S01 (§5G, ADR-0038): the owner's review of explainer scripts. A citation whose
// article is gone is left out rather than shown without its link, and counted; a script
// left with fewer than two cited articles can't be approved (AI-1). ADR-0058: sources
// are articles; a moment-era citation counts by its moment's article.
const MIN_SOURCES = 2;
export function kyselyAdminExplainers(db: Kysely<DB>): AdminExplainers {
  return {
    pending: async () => {
      const rows = await db
        .selectFrom("concept_explainer as x")
        .innerJoin("concept as c", "c.id", "x.concept_id")
        .select([
          "x.id",
          "c.name as concept",
          "x.script",
          "x.generator_model as model",
          "x.created_at as createdAt",
          "x.citations",
        ])
        .where("x.status", "=", "pending")
        .orderBy("x.created_at")
        .execute();
      const cited = await citedArticles(
        db,
        rows.map((r) => r.citations),
      );
      return rows.map((r, i): ExplainerReview => {
        const { articles, missing } = cited[i] ?? { articles: [], missing: 0 };
        return {
          id: r.id,
          concept: r.concept,
          script: r.script,
          model: r.model,
          createdAt: r.createdAt,
          missing,
          citations: articles.map((a) => ({
            itemId: a.itemId,
            articleTitle: a.title,
            link: a.link,
          })),
        };
      });
    },
    decide: async (id, decision, by) => {
      const done = await db
        .updateTable("concept_explainer")
        .set({
          status: decision,
          decided_by: by,
          decided_at: sql<Date>`now()`,
        })
        .where("id", "=", id)
        .where("status", "=", "pending")
        .$if(decision === "approved", (q) =>
          q.where(
            sql<boolean>`(select count(distinct ci.id)
              from jsonb_array_elements(citations) e
              join content_item ci on ci.id = coalesce(
                (e ->> 'content_item_id')::bigint,
                (select m.content_item_id from moment m
                 where m.id = (e ->> 'moment_id')::bigint))) >= ${MIN_SOURCES}`,
          ),
        )
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },
  };
}
