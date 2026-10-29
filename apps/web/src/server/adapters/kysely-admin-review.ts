import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import {
  isReasonKind,
  type AdminReview,
  type ReviewItem,
  type ReviewListing,
  type ReviewTags,
} from "../ports";

// Postgres adapter (ADR-0012) for the admin review page (ING-6, P1-W3-S05). Reads
// headings, counts, moments and tags; never body text (Q-P1-01).

function tags(
  difficulty: ReviewTags["difficulty"],
  concepts: string[],
): ReviewTags {
  return { difficulty, concepts: [...concepts].sort() };
}

export function kyselyAdminReview(db: Kysely<DB>): AdminReview {
  return {
    async recent(limit: number): Promise<ReviewListing[]> {
      // ADR-0026: items users reported a reason on come first, most reported first;
      // then the most recently fetched.
      const rows = await db
        .selectFrom("content_item as ci")
        .innerJoin("source as s", "s.id", "ci.source_id")
        .select((eb) => [
          "ci.id",
          "ci.title",
          "s.name as sourceName",
          eb
            .selectFrom("moment as m")
            .whereRef("m.content_item_id", "=", "ci.id")
            .select((m) => m.fn.countAll<string>().as("n"))
            .as("momentCount"),
          eb
            .selectFrom("reason_report as rr")
            .whereRef("rr.content_item_id", "=", "ci.id")
            .select((r) => r.fn.countAll<string>().as("n"))
            .as("reportCount"),
        ])
        .orderBy("reportCount", "desc")
        .orderBy("ci.fetched_at", "desc")
        .orderBy("ci.id", "desc")
        .limit(limit)
        .execute();
      const reported = rows.filter((r) => Number(r.reportCount ?? 0) > 0);
      const counts =
        reported.length === 0
          ? []
          : await db
              .selectFrom("reason_report")
              .select((eb) => [
                "content_item_id",
                "reason",
                eb.fn.countAll<string>().as("n"),
              ])
              .where(
                "content_item_id",
                "in",
                reported.map((r) => r.id),
              )
              .groupBy(["content_item_id", "reason"])
              .orderBy("n", "desc")
              .execute();
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        sourceName: r.sourceName,
        momentCount: Number(r.momentCount ?? 0),
        reports: counts
          .filter((c) => c.content_item_id === r.id)
          .flatMap((c) =>
            isReasonKind(c.reason)
              ? [{ reason: c.reason, count: Number(c.n) }]
              : [],
          ),
      }));
    },

    async item(id: string): Promise<ReviewItem | null> {
      // Past 18 digits it isn't a bigint id; Postgres would fail instead of a 404.
      if (!/^\d{1,18}$/.test(id)) return null;
      const head = await db
        .selectFrom("content_item as ci")
        .innerJoin("source as s", "s.id", "ci.source_id")
        .select(["ci.id", "ci.title", "ci.canonical_url", "s.name"])
        .where("ci.id", "=", id)
        .executeTakeFirst();
      if (head === undefined) return null;
      const [sections, moments, itemTag, momentTags, boundaries, overrides] =
        await Promise.all([
          db
            .selectFrom("content_item_section")
            .select(["heading", "level", "word_count"])
            .where("content_item_id", "=", id)
            .orderBy("ordinal")
            .execute(),
          db
            .selectFrom("moment")
            .select([
              "id",
              "ordinal",
              "title",
              "link_type",
              "estimated_minutes",
              "oversized",
            ])
            .where("content_item_id", "=", id)
            .orderBy("ordinal")
            .execute(),
          db
            .selectFrom("item_tagging as it")
            .select((eb) => [
              "it.difficulty",
              eb
                .selectFrom("item_concept as ic")
                .innerJoin("concept as c", "c.id", "ic.concept_id")
                .whereRef("ic.content_item_id", "=", "it.content_item_id")
                .select(
                  sql<string[]>`coalesce(array_agg(c.slug), '{}')`.as("slugs"),
                )
                .as("concepts"),
            ])
            .where("it.content_item_id", "=", id)
            .executeTakeFirst(),
          db
            .selectFrom("moment as m")
            .innerJoin("moment_tagging as mt", "mt.moment_id", "m.id")
            .select((eb) => [
              "m.ordinal",
              "mt.difficulty",
              eb
                .selectFrom("moment_concept as mc")
                .innerJoin("concept as c", "c.id", "mc.concept_id")
                .whereRef("mc.moment_id", "=", "m.id")
                .select(
                  sql<string[]>`coalesce(array_agg(c.slug), '{}')`.as("slugs"),
                )
                .as("concepts"),
            ])
            .where("m.content_item_id", "=", id)
            .execute(),
          db
            .selectFrom("moment_boundary_override")
            .select("headings")
            .where("content_item_id", "=", id)
            .executeTakeFirst(),
          db
            .selectFrom("tag_override")
            .select(["heading", "difficulty", "concepts"])
            .where("content_item_id", "=", id)
            .execute(),
        ]);
      return {
        id: head.id,
        title: head.title,
        url: head.canonical_url,
        sourceName: head.name,
        sections: sections.map((s) => ({
          heading: s.heading,
          level: s.level,
          wordCount: s.word_count,
        })),
        moments: moments.map((m) => ({
          ordinal: m.ordinal,
          title: m.title,
          heading: m.link_type === "page_top" ? null : m.title,
          estimatedMinutes: m.estimated_minutes,
          oversized: m.oversized,
        })),
        modelTags: {
          item: itemTag
            ? tags(itemTag.difficulty, itemTag.concepts ?? [])
            : null,
          moments: new Map(
            momentTags.map((t) => [
              t.ordinal,
              tags(t.difficulty, t.concepts ?? []),
            ]),
          ),
        },
        boundaries: boundaries?.headings ?? null,
        tagOverrides: new Map(
          overrides.map((o) => [o.heading, tags(o.difficulty, o.concepts)]),
        ),
      };
    },

    async activeConcepts(): Promise<string[]> {
      const rows = await db
        .selectFrom("concept")
        .select("slug")
        .where("retired_at", "is", null)
        .orderBy("slug")
        .execute();
      return rows.map((r) => r.slug);
    },

    async setBoundaries(itemId, headings, by): Promise<void> {
      if (headings === null) {
        await db
          .deleteFrom("moment_boundary_override")
          .where("content_item_id", "=", itemId)
          .execute();
        return;
      }
      await db
        .insertInto("moment_boundary_override")
        .values({ content_item_id: itemId, headings, updated_by: by })
        .onConflict((oc) =>
          oc.column("content_item_id").doUpdateSet({
            headings,
            updated_by: by,
            updated_at: sql`now()`,
          }),
        )
        .execute();
    },

    async setTags(itemId, heading, value, by): Promise<void> {
      if (value === null) {
        await db
          .deleteFrom("tag_override")
          .where("content_item_id", "=", itemId)
          .where("heading", "=", heading)
          .execute();
        return;
      }
      await db
        .insertInto("tag_override")
        .values({
          content_item_id: itemId,
          heading,
          difficulty: value.difficulty,
          concepts: value.concepts,
          updated_by: by,
        })
        .onConflict((oc) =>
          oc.columns(["content_item_id", "heading"]).doUpdateSet({
            difficulty: value.difficulty,
            concepts: value.concepts,
            updated_by: by,
            updated_at: sql`now()`,
          }),
        )
        .execute();
    },
  };
}
