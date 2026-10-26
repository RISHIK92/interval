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
  "article_title",
  "author",
  "source_name",
  "note_text",
  "note_ai",
  "frameable",
] as const;
type CardRow = Pick<
  Selectable<UserFeedVisible>,
  (typeof CARD_COLUMNS)[number]
> & {
  saved: boolean;
};

// Whether the user saved the card's article (P1-W5-S04), in the same query.
function savedBy(userId: string, itemColumn: string) {
  return sql<boolean>`exists (
    select 1 from user_save us
    where us.user_id = ${userId} and us.content_item_id = ${sql.ref(itemColumn)}
  )`.as("saved");
}

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
    article_title,
    source_name,
  } = row;
  if (
    content_item_id !== null &&
    article_title !== null &&
    source_name !== null
  ) {
    const base = {
      itemId: content_item_id,
      articleTitle: article_title,
      author: row.author,
      sourceName: source_name,
      note:
        row.note_text === null
          ? null
          : { text: row.note_text, ai: row.note_ai === true },
      saved: row.saved,
      frameable: row.frameable === true,
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
// The user's Not interested items and hidden sources leave the feed at once, before
// the recompute they queue lands (owner, P1-W4-S07).
function keptFor(userId: string, itemColumn: string) {
  const item = sql.ref(itemColumn);
  return sql<boolean>`not exists (
      select 1 from item_feedback f
      where f.user_id = ${userId} and f.content_item_id = ${item}
        and f.kind = 'not_interested'
    ) and not exists (
      select 1 from user_hidden_source h
      join content_item c on c.source_id = h.source_id
      where h.user_id = ${userId} and c.id = ${item}
    )`;
}

// What the user finished leaves the feed at once (P1-W5-S03 excludes it at ranking;
// a stored feed lasts until the next recompute): a finished section, and every card of
// a finished article.
function notFinishedBy(
  userId: string,
  momentColumn: string,
  itemColumn: string,
) {
  const moment = sql.ref(momentColumn);
  const item = sql.ref(itemColumn);
  return sql<boolean>`not exists (
      select 1 from user_moment_finished f
      where f.user_id = ${userId} and f.moment_id = ${moment}
    ) and not exists (
      select 1 from user_article_finished a
      where a.user_id = ${userId} and a.content_item_id = ${item}
    )`;
}

export function kyselyFeedReader(db: Kysely<DB>): FeedReader {
  return {
    read: async (userId, chip, limit) => {
      // The state row says "computed"; the left join brings the chip's cards, if any.
      const rows = await db
        .selectFrom("user_feed_state as s")
        .leftJoin("user_feed_visible as v", (join) =>
          join
            .onRef("v.user_id", "=", "s.user_id")
            .on("v.chip", "=", chip)
            .on(keptFor(userId, "v.content_item_id"))
            .on(notFinishedBy(userId, "v.moment_id", "v.content_item_id")),
        )
        .select(CARD_COLUMNS.map((column) => `v.${column}` as const))
        .select(savedBy(userId, "v.content_item_id"))
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
    starter: async (userId, topic, level, chip, limit) => {
      const rows = await db
        .selectFrom("starter_feed_visible")
        .select(CARD_COLUMNS)
        .select(savedBy(userId, "starter_feed_visible.content_item_id"))
        .where(keptFor(userId, "starter_feed_visible.content_item_id"))
        .where(
          notFinishedBy(
            userId,
            "starter_feed_visible.moment_id",
            "starter_feed_visible.content_item_id",
          ),
        )
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
