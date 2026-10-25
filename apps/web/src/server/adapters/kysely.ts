import type { DB, FeedVisible } from "@interval/db";
import { Kysely, PostgresDialect, sql, type Selectable } from "kysely";
import pg from "pg";
import { log } from "../log";
import type {
  DatabasePing,
  FeedCard,
  FeedReader,
  InviteCodes,
  Redemption,
} from "../ports";

// Postgres adapters (ADR-0012) for the server ports.

// Bounded waits so a dead or stalled database fails requests fast instead of pinning the pool.
const CONNECT_TIMEOUT_MS = 2000;
const QUERY_TIMEOUT_MS = 10_000;

export function createDb(connectionString: string): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  });
  // An idle client can die (failover, restart); without a listener pg-pool's error is unhandled.
  pool.on("error", (error) => {
    log.error("db pool: idle client error", { error });
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

export function kyselyPing(db: Kysely<DB>): DatabasePing {
  return {
    ping: async () => {
      await sql`select 1`.execute(db);
    },
  };
}

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
export function kyselyFeedReader(db: Kysely<DB>): FeedReader {
  return {
    list: async (limit) => {
      const rows = await db
        .selectFrom("feed_visible")
        .selectAll()
        .orderBy("rank")
        .limit(limit)
        .execute();
      return rows.map(toCard).filter((card) => card !== null);
    },
  };
}

// Pass a Transaction to redeem inside the caller's unit of work (see the port).
export function kyselyInviteCodes(db: Kysely<DB>): InviteCodes {
  return {
    redeem: async (code): Promise<Redemption> => {
      // One conditional update: concurrent redeems of the last use cannot both succeed.
      const used = await db
        .updateTable("invite_code")
        .set((eb) => ({ used_count: eb("used_count", "+", 1) }))
        .where("code", "=", sql<string>`normalize_invite_code(${code})`)
        .whereRef("used_count", "<", "max_uses")
        .where("expires_at", ">", sql<Date>`now()`)
        .returning(["id", "beta_group"])
        .executeTakeFirst();
      if (used !== undefined) {
        return { ok: true, inviteCodeId: used.id, betaGroup: used.beta_group };
      }
      const found = await db
        .selectFrom("invite_code")
        .select([
          "used_count",
          "max_uses",
          sql<boolean>`expires_at <= now()`.as("expired"),
        ])
        .where("code", "=", sql<string>`normalize_invite_code(${code})`)
        .executeTakeFirst();
      if (found === undefined) return { ok: false, reason: "unknown" };
      if (found.expired) return { ok: false, reason: "expired" };
      return { ok: false, reason: "used_up" };
    },
  };
}
