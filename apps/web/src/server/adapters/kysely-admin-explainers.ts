import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import type { AdminExplainers, ExplainerReview } from "../ports";

// P4-W22-S01 (§5G, ADR-0038): the owner's review of explainer scripts. A citation whose
// section is gone (re-segmented) is left out rather than shown without its link, and
// counted; a script left with fewer than two sources can't be approved (AI-1).
const MIN_SOURCES = 2;
const Cited = z.array(
  z.object({ moment_id: z.union([z.number(), z.string()]) }),
);
const cited = (raw: unknown) =>
  Cited.parse(raw).map((c) => String(c.moment_id));
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
      const ids = rows.flatMap((r) => cited(r.citations));
      const sections =
        ids.length === 0
          ? []
          : await db
              .selectFrom("moment as m")
              .innerJoin("content_item as ci", "ci.id", "m.content_item_id")
              .select([
                "m.id",
                "m.title as sectionTitle",
                "ci.title as articleTitle",
                "m.link",
              ])
              .where("m.id", "in", ids)
              .execute();
      const byId = new Map(sections.map((s) => [s.id, s]));
      return rows.map((r): ExplainerReview => {
        const found = cited(r.citations).flatMap((id) => {
          const m = byId.get(id);
          return m === undefined
            ? []
            : [
                {
                  momentId: m.id,
                  articleTitle: m.articleTitle,
                  sectionTitle: m.sectionTitle,
                  link: m.link,
                },
              ];
        });
        return {
          id: r.id,
          concept: r.concept,
          script: r.script,
          model: r.model,
          createdAt: r.createdAt,
          missing: cited(r.citations).length - found.length,
          citations: found,
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
            sql<boolean>`(select count(*) from jsonb_array_elements(citations) e
              join moment m on m.id = (e ->> 'moment_id')::bigint) >= ${MIN_SOURCES}`,
          ),
        )
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },
  };
}
