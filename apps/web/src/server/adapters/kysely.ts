import type { Capability, DB, UserFeedVisible } from "@interval/db";
import { Kysely, PostgresDialect, sql, type Selectable } from "kysely";
import pg from "pg";
import { log } from "../log";
import type {
  DatabasePing,
  Entitlements,
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
// The card columns, as both feed views name them (no summary or text, §3.2, ING-2).
const CARD_COLUMNS = [
  "rank",
  "kind",
  "content_item_id",
  "moment_id",
  "section_title",
  "section_number",
  "section_count",
  "estimated_minutes",
  "link",
  "article_title",
  "author",
  "source_name",
  "note_text",
  "note_ai",
] as const;
type CardRow = Pick<Selectable<UserFeedVisible>, (typeof CARD_COLUMNS)[number]>;

// Columns any row may leave null: no known author, no note yet.
const NULLABLE_ON_EVERY_ROW = ["author", "note_text", "note_ai"];
// Columns an article row also leaves null: it has no moment, and maybe no length.
const ARTICLE_NULLS = new Set([
  ...NULLABLE_ON_EVERY_ROW,
  "moment_id",
  "section_title",
  "section_number",
  "section_count",
  "estimated_minutes",
]);

export function toCard(row: CardRow): FeedCard | null {
  const {
    kind,
    content_item_id,
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
    content_item_id !== null &&
    link !== null &&
    article_title !== null &&
    source_name !== null
  ) {
    const base = {
      itemId: content_item_id,
      link,
      articleTitle: article_title,
      author: row.author,
      sourceName: source_name,
      note:
        row.note_text === null
          ? null
          : { text: row.note_text, ai: row.note_ai === true },
    };
    if (kind === "article") {
      return { kind, ...base, estimatedMinutes: estimated_minutes };
    }
    if (
      kind === "moment" &&
      moment_id !== null &&
      section_title !== null &&
      section_number !== null &&
      section_count !== null &&
      estimated_minutes !== null
    ) {
      return {
        kind,
        ...base,
        momentId: moment_id,
        sectionTitle: section_title,
        sectionNumber: section_number,
        sectionCount: section_count,
        estimatedMinutes: estimated_minutes,
      };
    }
  }
  const allowedNull =
    kind === "article" ? ARTICLE_NULLS : new Set(NULLABLE_ON_EVERY_ROW);
  const missing = Object.entries(row)
    .filter(([column, value]) => value === null && !allowedNull.has(column))
    .map(([column]) => column);
  log.error("feed: dropped a feed row with missing fields", {
    momentId: moment_id,
    itemId: content_item_id,
    missing,
  });
  return null;
}

// Reads the precomputed feed (CACHE-1); the worker writes it (ADR-0008).
export function kyselyFeedReader(db: Kysely<DB>): FeedReader {
  return {
    read: async (userId, chip, limit) => {
      // The state row says "computed"; the left join brings the chip's cards, if any.
      const rows = await db
        .selectFrom("user_feed_state as s")
        .leftJoin("user_feed_visible as v", (join) =>
          join.onRef("v.user_id", "=", "s.user_id").on("v.chip", "=", chip),
        )
        .select(CARD_COLUMNS.map((column) => `v.${column}` as const))
        .where("s.user_id", "=", userId)
        .orderBy("v.rank")
        .limit(limit)
        .execute();
      if (rows.length === 0) return { computed: false, cards: [] };
      // A computed feed with no entries in this chip comes back as one empty row.
      const cards = rows
        .filter((row) => row.content_item_id !== null)
        .map(toCard)
        .filter((card) => card !== null);
      return { computed: true, cards };
    },
    starter: async (topic, level, chip, limit) => {
      const rows = await db
        .selectFrom("starter_feed_visible")
        .select(CARD_COLUMNS)
        .where("topic", "=", topic)
        .where("level", "=", level)
        .where("chip", "=", chip)
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
    release: async (inviteCodeId) => {
      await db
        .updateTable("invite_code")
        .set((eb) => ({ used_count: eb("used_count", "-", 1) }))
        .where("id", "=", inviteCodeId)
        .where("used_count", ">", 0)
        .execute();
    },
  };
}

// Reads the user_entitlement view, which merges plan and per-user grants (Q-P1-22).
export function kyselyEntitlements(db: Kysely<DB>): Entitlements {
  const find = (userId: string, capability: Capability) =>
    db
      .selectFrom("user_entitlement")
      .select("limit_value")
      .where("user_id", "=", userId)
      .where("capability", "=", capability)
      .executeTakeFirst();
  return {
    can: async (userId, capability) =>
      (await find(userId, capability)) !== undefined,
    limit: async (userId, capability) => {
      const row = await find(userId, capability);
      return row === undefined ? 0 : row.limit_value;
    },
  };
}
