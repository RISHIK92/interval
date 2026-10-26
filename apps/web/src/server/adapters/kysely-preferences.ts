import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { GOALS, type PreferencesStore, TOPICS } from "../ports";

// Postgres adapter (ADR-0012) for the explicit preferences (PER-1, P1-W4-S01).
export function kyselyPreferences(db: Kysely<DB>): PreferencesStore {
  return {
    async get(userId) {
      const row = await db
        .selectFrom("user_preferences")
        .innerJoin("app_user", "app_user.id", "user_preferences.user_id")
        .select([
          // node-pg doesn't parse arrays of an enum type it doesn't know (topic[]):
          // read them as text[] and keep the values the enum allows.
          sql<string[]>`topics::text[]`.as("topics"),
          sql<string[]>`goals::text[]`.as("goals"),
          "level",
          "break_length",
          "onboarded_at",
          "app_user.name",
          "app_user.is_anonymous",
        ])
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (row === undefined) return null;
      const topics = TOPICS.filter((topic) => row.topics.includes(topic));
      const goals = GOALS.filter((goal) => row.goals.includes(goal));
      return {
        goals,
        topics,
        level: row.level,
        breakLength: row.break_length,
        onboardedAt: row.onboarded_at,
        // A guest is named "Anonymous" by Better Auth: no name to greet.
        firstName: row.is_anonymous
          ? null
          : row.name.trim().split(/\s+/)[0] || null,
      };
    },

    async update(userId, preferences) {
      const updated = await db
        .updateTable("user_preferences")
        .set({
          goals: preferences.goals,
          topics: preferences.topics,
          level: preferences.level,
          break_length: preferences.breakLength,
          updated_at: sql<Date>`now()`,
        })
        .where("user_id", "=", userId)
        .returning("user_id")
        .execute();
      return updated.length > 0;
    },

    async createIfAbsent(userId, preferences) {
      const inserted = await db
        .insertInto("user_preferences")
        .values({
          user_id: userId,
          goals: preferences.goals,
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
