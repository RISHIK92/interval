import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import { z } from "zod";
import { log } from "../log";
import type { RankingInspection, ScoreBreakdown } from "../ports";

// Postgres adapter (ADR-0012) for ranking inspection (P1-W6-S01). Titles come from the
// feed's visible view, so they follow the same rights gate the feed does (ING-2).

// Written by the worker (score_parts); checked here, where it crosses into the app.
const Breakdown = z.object({
  values: z.record(z.string(), z.number()),
  weights: z.record(z.string(), z.number()),
  weighted: z.record(z.string(), z.number()),
  penalty: z.number(),
});

// An older or broken shape shows as no breakdown, logged, rather than failing the page:
// the next recompute writes the current shape.
function breakdown(stored: unknown): ScoreBreakdown | null {
  if (stored === null) return null;
  const parsed = Breakdown.safeParse(stored);
  if (!parsed.success) {
    log.warn("ranking: unreadable score_parts", {
      issues: parsed.error.issues,
    });
    return null;
  }
  return parsed.data;
}

export function kyselyRanking(db: Kysely<DB>): RankingInspection {
  return {
    async entries(userId, chip) {
      const rows = await db
        .selectFrom("user_feed_visible as v")
        .innerJoin("user_feed_entry as e", (join) =>
          join
            .onRef("e.user_id", "=", "v.user_id")
            .onRef("e.chip", "=", "v.chip")
            .onRef("e.rank", "=", "v.rank"),
        )
        .select([
          "v.rank",
          "v.kind",
          "v.article_title",
          "v.section_title",
          "v.source_name",
          "e.top_signal",
          "e.explore_kind",
          "e.explore_arm",
          "e.score_parts",
        ])
        .where("v.user_id", "=", userId)
        .where("v.chip", "=", chip)
        .orderBy("v.rank")
        .execute();
      return rows.map((row) => ({
        rank: row.rank ?? 0,
        kind: row.kind === "article" ? "article" : "moment",
        articleTitle: row.article_title ?? "",
        sectionTitle: row.kind === "article" ? null : row.section_title,
        sourceName: row.source_name ?? "",
        topSignal: row.top_signal,
        explored:
          row.explore_kind !== null && row.explore_arm !== null
            ? { kind: row.explore_kind, arm: row.explore_arm }
            : null,
        breakdown: breakdown(row.score_parts),
      }));
    },

    async settings() {
      const rows = await db
        .selectFrom("ranking_config")
        .select(["key", "value", "note"])
        .orderBy("key")
        .execute();
      return rows.map((row) => ({ ...row, value: Number(row.value) }));
    },

    async setSetting(key, value) {
      const changed = await db
        .updateTable("ranking_config")
        .set({ value: String(value) })
        .where("key", "=", key)
        .where("value", "<>", String(value))
        .returning("key")
        .executeTakeFirst();
      if (changed !== undefined) return "changed";
      const exists = await db
        .selectFrom("ranking_config")
        .select("key")
        .where("key", "=", key)
        .executeTakeFirst();
      return exists === undefined ? "missing" : "unchanged";
    },
  };
}
