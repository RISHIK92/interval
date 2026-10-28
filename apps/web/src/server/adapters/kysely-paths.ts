import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { CHECKPOINT_SIZE, type PathStep, type Paths, passMark } from "../ports";
import {
  checkpointQuestions,
  everSkipped,
  place,
  readingsDone,
  sectionPassed,
  sessions,
  skipped,
} from "./checkpoints";
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
          "s.ordinal",
          place(userId, sql`s.id`).as("place"),
          sql<string[]>`array(
            select c.name from path_section_concept pc
            join concept c on c.id = pc.concept_id
            where pc.section_id = s.id order by c.name)`.as("concepts"),
          sectionPassed(userId, sql`s.id`).as("passed"),
          skipped(userId, sql`s.id`).as("skipped"),
          everSkipped(userId, sql`s.id`).as("ever_skipped"),
          readingsDone(userId, sql`s.id`).as("read"),
          sql<number>`least(${CHECKPOINT_SIZE},
            (select count(*) from (${checkpointQuestions(userId, sql`s.id`)}) cq))::int`.as(
            "size",
          ),
        ])
        .where("s.path_id", "=", pathId)
        .orderBy("place")
        .orderBy("s.ordinal")
        .execute();
      // The user's copy (P2-W10-S05): a swapped session reads its own moment.
      const { rows: readings } = await sql<{
        section_id: string;
        ordinal: number;
        moment_id: string;
        item_id: string;
        title: string;
        article_title: string;
        source_name: string;
        estimated_minutes: number;
        frameable: boolean | null;
        link_broken_at: Date | null;
        finished: boolean;
      }>`
        select s.id as section_id, ps.ordinal, m.id as moment_id,
               ci.id as item_id, m.title, ci.title as article_title,
               so.name as source_name, m.estimated_minutes, ci.frameable,
               ci.link_broken_at,
               exists (
                 select 1 from user_moment_finished f
                 where f.user_id = ${userId} and f.moment_id = m.id
               ) as finished
        from path_section s
        cross join lateral (${sessions(userId, sql`s.id`)}) ps
        join moment m on m.id = ps.moment_id
        join content_item ci on ci.id = m.content_item_id
        join source so on so.id = ci.source_id
        where s.path_id = ${pathId} and ${ALLOWED}
        order by ps.ordinal
      `.execute(db);
      // Open once every section before it is passed or was skipped (the user's
      // order); a section ahead of one the approved order teaches first is flagged.
      const steps: PathStep[] = sections.map((s, i) => {
        const open = sections
          .slice(0, i)
          .every((prev) => prev.passed || prev.ever_skipped);
        const ahead = sections
          .slice(i + 1)
          .filter((later) => later.ordinal < s.ordinal)
          .flatMap((later) => later.concepts);
        return {
          sectionId: s.id,
          concepts: s.concepts,
          readings: [],
          open,
          checkpoint: s.passed
            ? "passed"
            : s.skipped
              ? "skipped"
              : !open
                ? "locked"
                : !s.read
                  ? "reading"
                  : s.size > 0
                    ? "ready"
                    : "no_questions",
          size: s.size,
          passMark: passMark(s.size),
          skipped: s.skipped,
          warning: ahead.length > 0 ? ahead : null,
          holdsBack: !s.passed && !s.ever_skipped,
        };
      });
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
          ordinal: r.ordinal,
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
          return { firstTime: false, paused: null };
        const paused = await trx
          .updateTable("user_path")
          .set({ status: "paused", updated_at: sql<Date>`now()` })
          .where("user_id", "=", userId)
          .where("status", "=", "active")
          .returning("path_id")
          .executeTakeFirst();
        await trx
          .insertInto("user_path")
          .values({ user_id: userId, path_id: pathId, status: "active" })
          .onConflict((oc) =>
            oc
              .columns(["user_id", "path_id"])
              .doUpdateSet({ status: "active", updated_at: sql<Date>`now()` }),
          )
          .execute();
        return { firstTime: true, paused: paused?.path_id ?? null };
      }),

    pause: async (userId, pathId) => {
      const paused = await db
        .updateTable("user_path")
        .set({ status: "paused", updated_at: sql<Date>`now()` })
        .where("user_id", "=", userId)
        .where("path_id", "=", pathId)
        .where("status", "=", "active")
        .returning("path_id")
        .executeTakeFirst();
      return paused !== undefined;
    },

    moveSection: (userId, sectionId, direction) =>
      editing(db, userId, sectionId, async (trx, pathId) => {
        const order = await ownOrder(trx, userId, pathId);
        const i = order.findIndex((r) => r.section_id === sectionId);
        const other = order[direction === "up" ? i - 1 : i + 1];
        const self = order[i];
        if (self === undefined || other === undefined) return null;
        // The place constraint is deferred: the two swap places in one transaction.
        for (const [row, to] of [
          [self, other.ordinal],
          [other, self.ordinal],
        ] as const)
          await trx
            .updateTable("user_path_section")
            .set({ ordinal: to })
            .where("user_id", "=", userId)
            .where("section_id", "=", row.section_id)
            .execute();
        return pathId;
      }),

    skipSection: (userId, sectionId) =>
      editing(db, userId, sectionId, async (trx, pathId) => {
        const { rows } = await sql<{ passed: boolean; skipped: boolean }>`
          select ${sectionPassed(userId, sql`${sectionId}`)} as passed,
                 ${skipped(userId, sql`${sectionId}`)} as skipped
        `.execute(trx);
        if (rows[0]?.passed !== false || rows[0].skipped) return null;
        await ownOrder(trx, userId, pathId);
        await trx
          .updateTable("user_path_section")
          .set({ skipped_at: sql<Date>`now()`, unskipped_at: null })
          .where("user_id", "=", userId)
          .where("section_id", "=", sectionId)
          .execute();
        return pathId;
      }),

    unskipSection: (userId, sectionId) =>
      editing(db, userId, sectionId, async (trx, pathId) => {
        const done = await trx
          .updateTable("user_path_section")
          .set({ unskipped_at: sql<Date>`now()` })
          .where("user_id", "=", userId)
          .where("section_id", "=", sectionId)
          .where("skipped_at", "is not", null)
          .where("unskipped_at", "is", null)
          .returning("section_id")
          .executeTakeFirst();
        return done === undefined ? null : pathId;
      }),

    alternatives: async (userId, sectionId, ordinal) =>
      (
        (await editing(db, userId, sectionId, (trx) =>
          alternativesOf(trx, userId, sectionId, ordinal),
        )) ?? []
      ).map((r) => ({
        momentId: r.moment_id,
        sectionTitle: r.title,
        articleTitle: r.article_title,
        sourceName: r.source_name,
        minutes: r.estimated_minutes,
      })),

    swapSession: (userId, sectionId, ordinal, momentId) =>
      editing(db, userId, sectionId, async (trx, pathId) => {
        const offered = await alternativesOf(trx, userId, sectionId, ordinal);
        if (!offered.some((r) => r.moment_id === momentId)) return null;
        const approved = await trx
          .selectFrom("path_session")
          .select("moment_id")
          .where("section_id", "=", sectionId)
          .where("ordinal", "=", ordinal)
          .executeTakeFirstOrThrow();
        // Back to the approved moment: the copy no longer differs.
        if (approved.moment_id === momentId)
          await trx
            .deleteFrom("user_path_session")
            .where("user_id", "=", userId)
            .where("section_id", "=", sectionId)
            .where("ordinal", "=", ordinal)
            .execute();
        else
          await trx
            .insertInto("user_path_session")
            .values({
              user_id: userId,
              section_id: sectionId,
              ordinal,
              moment_id: momentId,
            })
            .onConflict((oc) =>
              oc
                .columns(["user_id", "section_id", "ordinal"])
                .doUpdateSet({ moment_id: momentId }),
            )
            .execute();
        return pathId;
      }),
  };
}

// An edit, in one transaction and one at a time per user (as start): only on a live
// path the user follows; body's result, or null when the edit isn't theirs to make.
async function editing<T>(
  db: Kysely<DB>,
  userId: string,
  sectionId: string,
  body: (trx: Kysely<DB>, pathId: string) => Promise<T | null>,
): Promise<T | null> {
  return inTransaction(db, async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext(${`user_path:${userId}`}))`.execute(
      trx,
    );
    const row = await trx
      .selectFrom("path_section as s")
      .innerJoin("path as p", "p.id", "s.path_id")
      .innerJoin("user_path as up", (join) =>
        join.onRef("up.path_id", "=", "p.id").on("up.user_id", "=", userId),
      )
      .select("p.id")
      .where("s.id", "=", sectionId)
      .where("p.status", "=", "live")
      .executeTakeFirst();
    return row === undefined ? null : body(trx, row.id);
  });
}

// The user's order, copied from the approved one on their first edit.
async function ownOrder(
  trx: Kysely<DB>,
  userId: string,
  pathId: string,
): Promise<{ section_id: string; ordinal: number }[]> {
  await sql`
    insert into user_path_section (user_id, path_id, section_id, ordinal)
    select ${userId}, ${pathId}, s.id, (row_number() over (order by s.ordinal)) - 1
    from path_section s
    where s.path_id = ${pathId} and not exists (
      select 1 from user_path_section u
      where u.user_id = ${userId} and u.path_id = ${pathId}
    )
  `.execute(trx);
  return trx
    .selectFrom("user_path_section")
    .select(["section_id", "ordinal"])
    .where("user_id", "=", userId)
    .where("path_id", "=", pathId)
    .orderBy("ordinal")
    .execute();
}

// Moments a session can be swapped to: the approved one first when swapped away, then
// others on one of the section's live concepts (an
// admin's correction replacing the model's tags, as kysely-progress), rights allowing
// (ING-2), link working (ING-6), not already in the user's section; only for a
// reading not yet finished.
async function alternativesOf(
  trx: Kysely<DB>,
  userId: string,
  sectionId: string,
  ordinal: number,
) {
  const approvedAt = sql`select ps.moment_id from path_session ps
    where ps.section_id = ${sectionId} and ps.ordinal = ${ordinal}`;
  const { rows } = await sql<{
    moment_id: string;
    title: string;
    article_title: string;
    source_name: string;
    estimated_minutes: number;
  }>`
    select m.id as moment_id, m.title, ci.title as article_title,
           so.name as source_name, m.estimated_minutes
    from moment m
    join content_item ci on ci.id = m.content_item_id
    join source so on so.id = ci.source_id
    where ${ALLOWED} and ci.link_broken_at is null
      and exists (
        select 1 from (${sessions(userId, sql`${sectionId}`)}) cur
        where cur.ordinal = ${ordinal} and not exists (
          select 1 from user_moment_finished f
          where f.user_id = ${userId} and f.moment_id = cur.moment_id
        )
      )
      and m.id not in (
        select moment_id from (${sessions(userId, sql`${sectionId}`)}) taken
      )
      -- The approved moment, while swapped away, is always offered (to swap back).
      and (m.id = (${approvedAt}) or exists (
        select 1 from path_section_concept pc
        join concept c on c.id = pc.concept_id and c.retired_at is null
        where pc.section_id = ${sectionId} and c.slug = any(coalesce(
          (select o.concepts from tag_override o
           where o.content_item_id = m.content_item_id
             and o.heading = m.title and m.link_type <> 'page_top'),
          array(select c2.slug from moment_concept mc
                join concept c2 on c2.id = mc.concept_id where mc.moment_id = m.id)
        ))
      ))
    order by m.id = (${approvedAt}) desc, m.id desc
    limit 5
  `.execute(trx);
  return rows;
}
