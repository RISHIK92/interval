import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { type PreferencesStore, TOPICS } from "../ports";

// Postgres adapter (ADR-0012) for the explicit preferences (PER-1, P1-W4-S01).
export function kyselyPreferences(db: Kysely<DB>): PreferencesStore {
  return {
    async get(userId) {
      const row = await db
        .selectFrom("user_preferences")
        .select([
          // node-pg doesn't parse arrays of an enum type it doesn't know (topic[]):
          // read them as text[] and keep the values the enum allows.
          sql<string[]>`topics::text[]`.as("topics"),
          "level",
          "break_length",
        ])
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (row === undefined) return null;
      const topics = TOPICS.filter((topic) => row.topics.includes(topic));
      return { topics, level: row.level, breakLength: row.break_length };
    },

    async createIfAbsent(userId, preferences) {
      const inserted = await db
        .insertInto("user_preferences")
        .values({
          user_id: userId,
          topics: preferences.topics,
          level: preferences.level,
          break_length: preferences.breakLength,
        })
        .onConflict((oc) => oc.column("user_id").doNothing())
        .returning("user_id")
        .executeTakeFirst();
      return inserted !== undefined;
    },
  };
}
