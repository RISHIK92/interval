import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import {
  CHECKPOINT_SIZE,
  isTopic,
  type PathStep,
  type Paths,
  passMark,
} from "../ports";
import {
  checkpointQuestions,
  everSkipped,
  place,
  readingsDone,
  sectionPassed,
  sessions,
  skipped,
} from "./checkpoints";
import { ALLOWED, articleTeaches } from "./path-rights";

// Following topic paths (§5F, Q-P2-27, P2-W10-S03): live paths, a path's timeline with
// what the user finished, and starting one (one active at a time).
// Kysely can't nest transactions: inside one (as the tests run), use it.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

export function kyselyPaths(db: Kysely<DB>): Paths {
  const paths: Paths = {
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
          // Readings and minutes as a reader would get them (ADR-0058: articles),
          // each article once per section, should one ever be in a section twice.
          sql<number>`(select count(*)::int from (
            select distinct s.id as section, ci.id as item from path_section s
            join path_session ps on ps.section_id = s.id
            join content_item ci on ci.id = ps.content_item_id
            join source so on so.id = ci.source_id
            where s.path_id = p.id and ${ALLOWED}) r)`.as("readings"),
          sql<number>`(select coalesce(sum(item_minutes(r.item)), 0)::int from (
            select distinct s.id as section, ci.id as item from path_section s
            join path_session ps on ps.section_id = s.id
            join content_item ci on ci.id = ps.content_item_id
            join source so on so.id = ci.source_id
            where s.path_id = p.id and ${ALLOWED}) r)`.as("minutes"),
          // The topic most of its concepts are on: the card's tag and filter.
          sql<string | null>`(select c.topic from path_section s
            join path_section_concept sc on sc.section_id = s.id
            join concept c on c.id = sc.concept_id and c.retired_at is null
            where s.path_id = p.id
            group by c.topic order by count(*) desc, c.topic limit 1)`.as(
            "topic",
          ),
          // Any of its concepts among the user's goal concepts (ADR-0015).
          sql<boolean>`exists (select 1 from path_section s
            join path_section_concept sc on sc.section_id = s.id
            join user_goal_concepts(${userId}) g on g.concept_id = sc.concept_id
            where s.path_id = p.id)`.as("fits_goal"),
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
        topic: r.topic !== null && isTopic(r.topic) ? r.topic : null,
        fitsGoal: r.fits_goal,
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
          // Q-P2-29: every live concept mastered for the user (none: not mastered).
          sql<boolean>`coalesce((
              select bool_and(cm.state is not distinct from 'mastered')
              from path_section_concept pc
              join concept c on c.id = pc.concept_id and c.retired_at is null
              left join concept_mastery cm on cm.concept_id = c.id
                and cm.user_id = ${userId}
              where pc.section_id = s.id
            ), false)`.as("mastered"),
          sql<number>`least(${CHECKPOINT_SIZE},
            (select count(*) from (${checkpointQuestions(userId, sql`s.id`)}) cq))::int`.as(
            "size",
          ),
        ])
        .where("s.path_id", "=", pathId)
        .orderBy("place")
        .orderBy("s.ordinal")
        .execute();
      // The user's copy (P2-W10-S05): a swapped session reads its own article.
      // ADR-0058: a reading is finished when its article is completed.
      const { rows: readings } = await sql<{
        section_id: string;
        ordinal: number;
        item_id: string;
        article_title: string;
        source_name: string;
        minutes: number | null;
        frameable: boolean | null;
        link_broken_at: Date | null;
        finished: boolean;
      }>`
        select s.id as section_id, ps.ordinal, ci.id as item_id,
               ci.title as article_title, so.name as source_name,
               item_minutes(ci.id) as minutes, ci.frameable, ci.link_broken_at,
               exists (
                 select 1 from user_article_finished f
                 where f.user_id = ${userId} and f.content_item_id = ci.id
               ) as finished
        from path_section s
        cross join lateral (${sessions(userId, sql`s.id`)}) ps
        join content_item ci on ci.id = ps.content_item_id
        join source so on so.id = ci.source_id
        where s.path_id = ${pathId} and ${ALLOWED}
        order by ps.ordinal
      `.execute(db);
      // Q-P2-30: a section's direct prerequisites outside the path, never explored, each
      // with its newest reading (rights allowing, link working, as the swap list).
      const { rows: foundations } = await sql<{
        section_id: string;
        concept_id: string;
        name: string;
        item_id: string | null;
        title: string | null;
        frameable: boolean | null;
      }>`
        select distinct on (pc.section_id, f.id)
               pc.section_id, f.id as concept_id, f.name, r.item_id, r.title, r.frameable
        from path_section s
        join path_section_concept pc on pc.section_id = s.id
        join concept c on c.id = pc.concept_id and c.retired_at is null
        join concept_edge e on e.to_id = c.id and e.type = 'prerequisite_of'
        join concept f on f.id = e.from_id and f.retired_at is null
        left join lateral (
          select ci.id as item_id, ci.title, ci.frameable
          from content_item ci
          join source so on so.id = ci.source_id
          where ${ALLOWED} and ci.link_broken_at is null
            and ${articleTeaches(sql`f.id`)}
          order by ci.id desc
          limit 1
        ) r on true
        where s.path_id = ${pathId}
          and f.id not in (
            select own.concept_id from path_section_concept own
            join path_section os on os.id = own.section_id
            where os.path_id = ${pathId}
          )
          and not exists (
            select 1 from concept_mastery cm
            where cm.user_id = ${userId} and cm.concept_id = f.id
          )
        order by pc.section_id, f.id
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
          mastered: s.mastered,
          foundations:
            open && !s.skipped
              ? foundations
                  .filter((f) => f.section_id === s.id)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .slice(0, 3)
                  .map((f) => ({
                    conceptId: f.concept_id,
                    name: f.name,
                    reading:
                      f.item_id === null || f.title === null
                        ? null
                        : {
                            itemId: f.item_id,
                            articleTitle: f.title,
                            frameable: f.frameable === true,
                            linkBroken: false,
                          },
                  }))
              : [],
        };
      });
      const byId = new Map(steps.map((s) => [s.sectionId, s]));
      for (const r of readings)
        byId.get(r.section_id)?.readings.push({
          itemId: r.item_id,
          articleTitle: r.article_title,
          sourceName: r.source_name,
          minutes: r.minutes,
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

    // From the timeline, so it follows the user's own copy (P2-W10-S06).
    next: async (userId) => {
      const active = await db
        .selectFrom("user_path as up")
        .innerJoin("path as p", "p.id", "up.path_id")
        .select("p.id")
        .where("up.user_id", "=", userId)
        .where("up.status", "=", "active")
        .where("p.status", "=", "live")
        .executeTakeFirst();
      if (active === undefined) return null;
      const timeline = await paths.path(userId, active.id);
      if (timeline === null) return null;
      const going = timeline.sections.filter((s) => s.open && !s.skipped);
      for (const section of going) {
        const i = section.readings.findIndex(
          (r) => !r.finished && !r.linkBroken,
        );
        const reading = section.readings[i];
        if (reading !== undefined)
          return {
            kind: "reading",
            pathId: timeline.pathId,
            pathName: timeline.name,
            sectionId: section.sectionId,
            // As the path page: a passed section isn't offered for skipping.
            mastered: section.mastered && section.checkpoint !== "passed",
            concepts: section.concepts,
            reading,
            n: i + 1,
            of: section.readings.length,
          };
      }
      const ready = going.find((s) => s.checkpoint === "ready");
      if (ready === undefined) return null;
      const after =
        timeline.sections[timeline.sections.indexOf(ready) + 1] ?? null;
      return {
        kind: "checkpoint",
        pathId: timeline.pathId,
        pathName: timeline.name,
        sectionId: ready.sectionId,
        concepts: ready.concepts,
        size: ready.size,
        passMark: ready.passMark,
        next: after === null ? null : after.concepts,
      };
    },

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
        itemId: r.item_id,
        articleTitle: r.article_title,
        sourceName: r.source_name,
        minutes: r.minutes,
      })),

    swapSession: (userId, sectionId, ordinal, itemId) =>
      editing(db, userId, sectionId, async (trx, pathId) => {
        const offered = await alternativesOf(trx, userId, sectionId, ordinal);
        if (!offered.some((r) => r.item_id === itemId)) return null;
        const approved = await trx
          .selectFrom("path_session")
          .select("content_item_id")
          .where("section_id", "=", sectionId)
          .where("ordinal", "=", ordinal)
          .executeTakeFirstOrThrow();
        // Back to the approved article: the copy no longer differs.
        if (approved.content_item_id === itemId)
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
              content_item_id: itemId,
            })
            .onConflict((oc) =>
              oc
                .columns(["user_id", "section_id", "ordinal"])
                .doUpdateSet({ content_item_id: itemId }),
            )
            .execute();
        return pathId;
      }),
  };
  return paths;
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

// Articles a session can be swapped to (ADR-0058): the approved one first when swapped
// away, then others on one of the section's live concepts (an admin's correction
// replacing the model's tags, as kysely-progress), rights allowing (ING-2), link
// working (ING-6), not already in the user's section; only for a reading not yet
// completed.
async function alternativesOf(
  trx: Kysely<DB>,
  userId: string,
  sectionId: string,
  ordinal: number,
) {
  const approvedAt = sql`select ps.content_item_id from path_session ps
    where ps.section_id = ${sectionId} and ps.ordinal = ${ordinal}`;
  const { rows } = await sql<{
    item_id: string;
    article_title: string;
    source_name: string;
    minutes: number | null;
  }>`
    select ci.id as item_id, ci.title as article_title,
           so.name as source_name, item_minutes(ci.id) as minutes
    from content_item ci
    join source so on so.id = ci.source_id
    where ${ALLOWED} and ci.link_broken_at is null
      and exists (
        select 1 from (${sessions(userId, sql`${sectionId}`)}) cur
        where cur.ordinal = ${ordinal} and not exists (
          select 1 from user_article_finished f
          where f.user_id = ${userId} and f.content_item_id = cur.content_item_id
        )
      )
      and ci.id not in (
        select content_item_id from (${sessions(userId, sql`${sectionId}`)}) taken
      )
      -- The approved article, while swapped away, is always offered (to swap back).
      and (ci.id = (${approvedAt}) or exists (
        select 1 from path_section_concept pc
        where pc.section_id = ${sectionId} and ${articleTeaches(sql`pc.concept_id`)}
      ))
    order by ci.id = (${approvedAt}) desc, ci.id desc
    limit 5
  `.execute(trx);
  return rows;
}
