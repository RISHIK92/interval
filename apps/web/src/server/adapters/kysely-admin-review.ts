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
// headings, counts and tags; never body text (Q-P1-01). ADR-0058: tags and their
// override are the whole article's; section overrides left from before wait for stage
// C to fold them in, and nothing here reads or writes them.

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
      const [sections, itemTag, override] = await Promise.all([
        db
          .selectFrom("content_item_section")
          .select(["heading", "level", "word_count"])
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
          .selectFrom("tag_override")
          .select(["difficulty", "concepts"])
          .where("content_item_id", "=", id)
          .where("heading", "=", "")
          .executeTakeFirst(),
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
        modelTags: itemTag
          ? tags(itemTag.difficulty, itemTag.concepts ?? [])
          : null,
        tagOverride: override
          ? tags(override.difficulty, override.concepts)
          : null,
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

    // The whole article's row is heading '' (ADR-0058).
    async setTags(itemId, value, by): Promise<void> {
      if (value === null) {
        await db
          .deleteFrom("tag_override")
          .where("content_item_id", "=", itemId)
          .where("heading", "=", "")
          .execute();
        return;
      }
      await db
        .insertInto("tag_override")
        .values({
          content_item_id: itemId,
          heading: "",
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
