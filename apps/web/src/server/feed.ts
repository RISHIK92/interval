import type { DB, FeedVisible } from "@interval/db";
import type { Kysely, Selectable } from "kysely";
import { log } from "./log";

// What a card may show (§3.2, ING-2): no summary or body text exists in feed_visible.
export type FeedCard = {
  momentId: string;
  sectionTitle: string;
  sectionNumber: number;
  sectionCount: number;
  estimatedMinutes: number;
  link: string;
  articleTitle: string;
  author: string | null;
  sourceName: string;
};

const FEED_LIMIT = 50;

// View columns are nullable in the generated types; a null here means a broken view, so
// the row is dropped and only its id and the missing column names are logged.
export function toCard(row: Selectable<FeedVisible>): FeedCard | null {
  const {
    moment_id,
    section_title,
    section_number,
    section_count,
    estimated_minutes,
    link,
    article_title,
    source_name,
  } = row;
  if (
    moment_id === null ||
    section_title === null ||
    section_number === null ||
    section_count === null ||
    estimated_minutes === null ||
    link === null ||
    article_title === null ||
    source_name === null
  ) {
    const missing = Object.entries(row)
      .filter(([column, value]) => value === null && column !== "author")
      .map(([column]) => column);
    log.error("feed: dropped a feed_visible row with missing fields", {
      momentId: moment_id,
      missing,
    });
    return null;
  }
  return {
    momentId: moment_id,
    sectionTitle: section_title,
    sectionNumber: section_number,
    sectionCount: section_count,
    estimatedMinutes: estimated_minutes,
    link,
    articleTitle: article_title,
    author: row.author,
    sourceName: source_name,
  };
}

// Reads the precomputed feed (CACHE-1); the worker writes it (ADR-0008).
export async function getFeed(db: Kysely<DB>): Promise<FeedCard[]> {
  const rows = await db
    .selectFrom("feed_visible")
    .selectAll()
    .orderBy("rank")
    .limit(FEED_LIMIT)
    .execute();
  return rows.map(toCard).filter((card) => card !== null);
}
