import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { PathStep, Paths } from "../ports";
import { ALLOWED } from "./path-rights";

// Following topic paths (§5F, Q-P2-27, P2-W10-S03): live paths, a path's timeline with
// what the user finished, and starting one (one active at a time).
// Kysely can't nest transactions: inside one (as the tests run), use it.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

export function kyselyPaths(db: Kysely<DB>): Paths {
  return {
    live: async (userId) => {
      const rows = await db
        .selectFrom("path as p")
        .leftJoin("user_path as up", (join) =>
          join.onRef("up.path_id", "=", "p.id").on("up.user_id", "=", userId),
        )
        .select([
          "p.id",
          "p.name",
          "p.why",
          "p.status",
          "up.status as mine",
          sql<number>`(select count(*)::int from path_section s
            where s.path_id = p.id)`.as("sections"),
          // Readings and minutes as a reader would get them: rights allowing.
          sql<number>`(select count(*)::int from path_section s
            join path_session ps on ps.section_id = s.id
            join moment m on m.id = ps.moment_id
            join content_item ci on ci.id = m.content_item_id
            join source so on so.id = ci.source_id
            where s.path_id = p.id and ${ALLOWED})`.as("readings"),
          sql<number>`(select coalesce(sum(m.estimated_minutes), 0)::int
            from path_section s
            join path_session ps on ps.section_id = s.id
            join moment m on m.id = ps.moment_id
            join content_item ci on ci.id = m.content_item_id
            join source so on so.id = ci.source_id
            where s.path_id = p.id and ${ALLOWED})`.as("minutes"),
        ])
        // A retired path stays for those who followed it (owner, 2026-10-28).
        .where((eb) =>
          eb.or([
            eb("p.status", "=", "live"),
            eb.and([
              eb("p.status", "=", "retired"),
              eb("up.status", "is not", null),
            ]),
          ]),
        )
        .orderBy("p.decided_at")
        .orderBy("p.id")
        .execute();
      return rows.map((r) => ({
        pathId: r.id,
        name: r.name,
        why: r.why,
        sections: r.sections,
        readings: r.readings,
        minutes: r.minutes,
        mine: r.mine,
        retired: r.status === "retired",
      }));
    },

    path: async (userId, pathId) => {
      const head = await db
        .selectFrom("path as p")
        .leftJoin("user_path as up", (join) =>
          join.onRef("up.path_id", "=", "p.id").on("up.user_id", "=", userId),
        )
        .select(["p.id", "p.name", "p.why", "p.status", "up.status as mine"])
        .where("p.id", "=", pathId)
        .executeTakeFirst();
      // Live for everyone; retired only for those who follow it; drafts for no one.
      if (
        head === undefined ||
        head.status === "draft" ||
        (head.status === "retired" && head.mine === null)
      )
        return null;
      const sections = await db
        .selectFrom("path_section as s")
        .select([
          "s.id",
          sql<string[]>`array(
            select c.name from path_section_concept pc
            join concept c on c.id = pc.concept_id
            where pc.section_id = s.id order by c.name)`.as("concepts"),
        ])
        .where("s.path_id", "=", pathId)
        .orderBy("s.ordinal")
        .execute();
      const readings = await db
        .selectFrom("path_session as ps")
        .innerJoin("path_section as s", "s.id", "ps.section_id")
        .innerJoin("moment as m", "m.id", "ps.moment_id")
        .innerJoin("content_item as ci", "ci.id", "m.content_item_id")
        .innerJoin("source as so", "so.id", "ci.source_id")
        .select([
          "ps.section_id",
          "m.id as moment_id",
          "ci.id as item_id",
          "m.title",
          "ci.title as article_title",
          "so.name as source_name",
          "m.estimated_minutes",
          "ci.frameable",
          "ci.link_broken_at",
          sql<boolean>`exists (
            select 1 from user_moment_finished f
            where f.user_id = ${userId} and f.moment_id = m.id)`.as("finished"),
        ])
        .where("s.path_id", "=", pathId)
        .where(ALLOWED)
        .orderBy("ps.ordinal")
        .execute();
      const steps: PathStep[] = sections.map((s, i) => ({
        sectionId: s.id,
        concepts: s.concepts,
        readings: [],
        // S04 opens the next section when its checkpoint is passed.
        open: i === 0,
      }));
      const byId = new Map(steps.map((s) => [s.sectionId, s]));
      for (const r of readings)
        byId.get(r.section_id)?.readings.push({
          momentId: r.moment_id,
          itemId: r.item_id,
          sectionTitle: r.title,
          articleTitle: r.article_title,
          sourceName: r.source_name,
          minutes: r.estimated_minutes,
          frameable: r.frameable === true,
          linkBroken: r.link_broken_at !== null,
          finished: r.finished,
        });
      return {
        pathId: head.id,
        name: head.name,
        why: head.why,
        retired: head.status === "retired",
        mine: head.mine,
        sections: steps,
      };
    },

    // In one transaction: the other active path paused first (the one-active index
    // is checked row by row, so it can't happen in the same statement), then this one
    // made active, only when it's live.
    start: (userId, pathId) =>
      inTransaction(db, async (trx) => {
        const live = await trx
          .selectFrom("path")
          .select("id")
          .where("id", "=", pathId)
          .where("status", "=", "live")
          .executeTakeFirst();
        if (live === undefined) return null;
        // Two starts by one user take turns, even before they have any row.
        await sql`select pg_advisory_xact_lock(hashtext(${`user_path:${userId}`}))`.execute(
          trx,
        );
        const mine = await trx
          .selectFrom("user_path")
          .select(["path_id", "status"])
          .where("user_id", "=", userId)
          .execute();
        if (mine.some((r) => r.path_id === pathId && r.status === "active"))
          return false;
        await trx
          .updateTable("user_path")
          .set({ status: "paused", updated_at: sql<Date>`now()` })
          .where("user_id", "=", userId)
          .where("status", "=", "active")
          .execute();
        await trx
          .insertInto("user_path")
          .values({ user_id: userId, path_id: pathId, status: "active" })
          .onConflict((oc) =>
            oc
              .columns(["user_id", "path_id"])
              .doUpdateSet({ status: "active", updated_at: sql<Date>`now()` }),
          )
          .execute();
        return true;
      }),
  };
}
