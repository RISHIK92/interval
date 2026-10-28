import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { AdminPaths, PathStatus, ReviewPath } from "../ports";
import { ALLOWED } from "./path-rights";

const ORDER: Record<PathStatus, number> = { draft: 0, live: 1, retired: 2 };

// Kysely can't nest transactions: inside one (as the tests run), use it.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

// §5F, Q-P2-23 (P2-W10-S02): the owner's review of proposed topic paths. Edits change
// drafts only: a live path is followed by users and changes under no one.
export function kyselyAdminPaths(db: Kysely<DB>): AdminPaths {
  // The section, if its path is still a draft.
  const draftSection = (trx: Kysely<DB>, sectionId: string) =>
    trx
      .selectFrom("path_section as s")
      .innerJoin("path as p", "p.id", "s.path_id")
      .select(["s.id", "s.path_id", "s.ordinal"])
      .where("s.id", "=", sectionId)
      .where("p.status", "=", "draft")
      .forUpdate()
      .executeTakeFirst();

  return {
    list: async () => {
      const paths = await db
        .selectFrom("path")
        .select(["id", "name", "why", "status"])
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .execute();
      const sections = await db
        .selectFrom("path_section as s")
        .select([
          "s.id",
          "s.path_id",
          sql<string[]>`array(
            select c.name from path_section_concept pc
            join concept c on c.id = pc.concept_id
            where pc.section_id = s.id order by c.name)`.as("concepts"),
        ])
        .orderBy("s.path_id")
        .orderBy("s.ordinal")
        .execute();
      // Each reading with its rights as they are now (ING-2).
      const sessions = await db
        .selectFrom("path_session as ps")
        .innerJoin("moment as m", "m.id", "ps.moment_id")
        .innerJoin("content_item as ci", "ci.id", "m.content_item_id")
        .innerJoin("source as so", "so.id", "ci.source_id")
        .select([
          "ps.section_id",
          "ps.ordinal",
          "ps.moment_id",
          "m.title",
          "m.link",
          "ci.title as article_title",
          "so.name as source_name",
          ALLOWED.as("allowed"),
        ])
        .orderBy("ps.section_id")
        .orderBy("ps.ordinal")
        .execute();
      const bySection = new Map<string, ReviewPath["sections"][number]>();
      const byPath = new Map<string, ReviewPath["sections"]>();
      for (const s of sections) {
        const section = { sectionId: s.id, concepts: s.concepts, sessions: [] };
        bySection.set(s.id, section);
        byPath.set(s.path_id, [...(byPath.get(s.path_id) ?? []), section]);
      }
      for (const r of sessions)
        bySection.get(r.section_id)?.sessions.push({
          ordinal: r.ordinal,
          momentId: r.moment_id,
          sectionTitle: r.title,
          articleTitle: r.article_title,
          sourceName: r.source_name,
          link: r.link,
          allowed: r.allowed,
        });
      return paths
        .map((p) => ({
          pathId: p.id,
          name: p.name,
          why: p.why,
          status: p.status,
          sections: byPath.get(p.id) ?? [],
        }))
        .sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    },

    rename: async (pathId, name, why) => {
      const updated = await db
        .updateTable("path")
        .set({ name, why })
        .where("id", "=", pathId)
        .where("status", "=", "draft")
        .executeTakeFirst();
      return updated.numUpdatedRows > 0n;
    },

    // unique (path_id, ordinal) isn't deferrable: the swap goes through a free
    // ordinal (one past the last), in one transaction.
    moveSection: (sectionId, direction) =>
      inTransaction(db, async (trx) => {
        const section = await draftSection(trx, sectionId);
        if (section === undefined) return false;
        const neighbour = await trx
          .selectFrom("path_section")
          .select(["id", "ordinal"])
          .where("path_id", "=", section.path_id)
          .where("ordinal", direction === "up" ? "<" : ">", section.ordinal)
          .orderBy("ordinal", direction === "up" ? "desc" : "asc")
          .limit(1)
          .forUpdate()
          .executeTakeFirst();
        if (neighbour === undefined) return false;
        const set = (id: string, ordinal: number) =>
          trx
            .updateTable("path_section")
            .set({ ordinal })
            .where("id", "=", id)
            .execute();
        const top = await trx
          .selectFrom("path_section")
          .select(sql<number>`max(ordinal)`.as("top"))
          .where("path_id", "=", section.path_id)
          .executeTakeFirstOrThrow();
        await set(section.id, top.top + 1);
        await set(neighbour.id, section.ordinal);
        await set(section.id, neighbour.ordinal);
        return true;
      }),

    removeSection: (sectionId) =>
      inTransaction(db, async (trx) => {
        if ((await draftSection(trx, sectionId)) === undefined) return false;
        await trx
          .deleteFrom("path_section")
          .where("id", "=", sectionId)
          .execute();
        return true;
      }),

    removeSession: (sectionId, ordinal) =>
      inTransaction(db, async (trx) => {
        if ((await draftSection(trx, sectionId)) === undefined) return false;
        const removed = await trx
          .deleteFrom("path_session")
          .where("section_id", "=", sectionId)
          .where("ordinal", "=", ordinal)
          .executeTakeFirst();
        return removed.numDeletedRows > 0n;
      }),

    // Live only with at least 2 sections, each with a reading its rights allow now.
    // The path is locked first, so the checks below (a new statement, a fresh
    // snapshot) see any edit that committed while this waited.
    approve: (pathId) =>
      inTransaction(db, async (trx) => {
        const locked = await trx
          .selectFrom("path")
          .select("id")
          .where("id", "=", pathId)
          .where("status", "=", "draft")
          .forUpdate()
          .executeTakeFirst();
        if (locked === undefined) return false;
        const { rows } = await sql<{ id: string }>`
          update path set status = 'live', decided_at = now()
          where id = ${pathId}
            and (select count(*) from path_section where path_id = ${pathId}) >= 2
            and not exists (
              select 1 from path_section s
              where s.path_id = ${pathId} and not exists (
                select 1 from path_session ps
                join moment m on m.id = ps.moment_id
                join content_item ci on ci.id = m.content_item_id
                join source so on so.id = ci.source_id
                where ps.section_id = s.id and ${ALLOWED}
              )
            )
          returning id
        `.execute(trx);
        return rows.length > 0;
      }),

    // Retired, and paused for everyone following it: it stays in their list,
    // read-only, and leaves their feed (owner, 2026-10-28).
    retire: (pathId) =>
      inTransaction(db, async (trx) => {
        const updated = await trx
          .updateTable("path")
          .set({ status: "retired", decided_at: sql<Date>`now()` })
          .where("id", "=", pathId)
          .where("status", "in", ["draft", "live"])
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) return false;
        await trx
          .updateTable("user_path")
          .set({ status: "paused", updated_at: sql<Date>`now()` })
          .where("path_id", "=", pathId)
          .where("status", "=", "active")
          .execute();
        return true;
      }),
  };
}
