import { Caption, type ListenExplainer } from "@interval/api-client";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import type { Listening } from "../ports";
import { citedArticles } from "./explainer-citations";

// P4-W23-S01 (§5G, §5I): the audio queue. Only approved explainers with audio are ever
// offered, queued or played; a citation whose article is gone is left out of the
// sources rather than shown without its link (as the admin page does). ADR-0058: each
// source is a cited article, linked to its page.
// TTS-3 (P4-W23-S03): made by the worker at voicing, in the script's own words.
const Captions = z.array(Caption);

type Row = {
  explainerId: string;
  conceptId: string;
  concept: string;
  playlist: string;
  duration: string;
  position: string | null;
  citations: unknown;
  captions: unknown;
  scene: string | null;
};

function voicedExplainers(db: Kysely<DB>) {
  return (
    db
      .selectFrom("concept_explainer as x")
      .innerJoin("explainer_audio as a", "a.explainer_id", "x.id")
      .innerJoin("concept as c", "c.id", "x.concept_id")
      // P4.5-W27-S01: one timeline per explainer, offered only once approved.
      .leftJoin("explainer_scene as s", (j) =>
        j.onRef("s.explainer_id", "=", "x.id").on("s.status", "=", "approved"),
      )
      .where("x.status", "=", "approved")
  );
}

export function kyselyListening(db: Kysely<DB>): Listening {
  async function explained(rows: Row[]): Promise<ListenExplainer[]> {
    const cited = await citedArticles(
      db,
      rows.map((r) => r.citations),
    );
    return rows.map((r, i) => ({
      explainerId: r.explainerId,
      conceptId: r.conceptId,
      concept: r.concept,
      src: `/${r.playlist}`,
      durationSeconds: Number(r.duration),
      positionSeconds: Number(r.position ?? 0),
      sources: (cited[i]?.articles ?? []).map((a) => ({
        title: a.title,
        href: a.link,
      })),
      captions: Captions.parse(r.captions),
      scene: r.scene === null ? null : `/${r.scene}`,
    }));
  }

  const columns = [
    "x.id as explainerId",
    "x.concept_id as conceptId",
    "c.name as concept",
    "a.playlist_key as playlist",
    "a.duration_seconds as duration",
    "x.citations",
    "a.captions",
    "s.scene_key as scene",
  ] as const;

  return {
    // ADR-0058: the article's concepts; an admin's whole-article tags replace the
    // model's, as reading credits them (kysely-progress.ts).
    voiced: async (itemId) => {
      const rows = await voicedExplainers(db)
        .select("x.id")
        .where(
          sql<boolean>`c.slug = any(coalesce(
            (select o.concepts from tag_override o
             where o.content_item_id = ${itemId}),
            array(select c2.slug from item_concept ic
                  join concept c2 on c2.id = ic.concept_id
                  where ic.content_item_id = ${itemId})
          ))`,
        )
        .orderBy("c.name")
        .orderBy("x.id")
        .execute();
      return rows.map((r) => r.id);
    },
    queue: async (userId) => {
      const queued = await voicedExplainers(db)
        .innerJoin("listen_queue as q", (j) =>
          j.onRef("q.explainer_id", "=", "x.id").on("q.user_id", "=", userId),
        )
        .leftJoin("explainer_listen as l", (j) =>
          j.onRef("l.explainer_id", "=", "x.id").on("l.user_id", "=", userId),
        )
        // A finished one queued again starts over (as start does).
        .select([
          ...columns,
          sql<string>`case when l.finished_at is null then l.position_seconds else 0 end`.as(
            "position",
          ),
        ])
        .orderBy("q.added_at")
        .orderBy("x.id")
        .execute();
      // Up next: a concept joined by an edge to the one last finished, voiced, neither
      // queued nor finished; what it unlocks first (prerequisite_of), then by name.
      const last = await db
        .selectFrom("explainer_listen as l")
        .innerJoin("concept_explainer as x", "x.id", "l.explainer_id")
        .select("x.concept_id")
        .where("l.user_id", "=", userId)
        .where("l.finished_at", "is not", null)
        .orderBy("l.finished_at", "desc")
        .orderBy("l.explainer_id", "desc")
        .limit(1)
        .executeTakeFirst();
      const next =
        last === undefined
          ? undefined
          : await voicedExplainers(db)
              .innerJoin("concept_edge as e", (j) =>
                j.on((eb) =>
                  eb.or([
                    eb.and([
                      eb("e.from_id", "=", last.concept_id),
                      eb("e.to_id", "=", eb.ref("x.concept_id")),
                    ]),
                    eb.and([
                      eb("e.to_id", "=", last.concept_id),
                      eb("e.from_id", "=", eb.ref("x.concept_id")),
                    ]),
                  ]),
                ),
              )
              .where((eb) =>
                eb.not(
                  eb.exists(
                    eb
                      .selectFrom("listen_queue as q")
                      .select("q.explainer_id")
                      .whereRef("q.explainer_id", "=", "x.id")
                      .where("q.user_id", "=", userId),
                  ),
                ),
              )
              .where((eb) =>
                eb.not(
                  eb.exists(
                    eb
                      .selectFrom("explainer_listen as f")
                      .select("f.explainer_id")
                      .whereRef("f.explainer_id", "=", "x.id")
                      .where("f.user_id", "=", userId)
                      .where("f.finished_at", "is not", null),
                  ),
                ),
              )
              .select([...columns, sql<null>`null`.as("position")])
              .orderBy(
                sql`(e.from_id = ${last.concept_id} and e.type = 'prerequisite_of')`,
                "desc",
              )
              .orderBy("c.name")
              .orderBy("x.id")
              .limit(1)
              .executeTakeFirst();
      const all = await explained(
        next === undefined ? queued : [...queued, next],
      );
      return {
        queue: all.slice(0, queued.length),
        upNext: next === undefined ? null : (all.at(-1) ?? null),
      };
    },
    add: async (userId, explainerIds) => {
      if (explainerIds.length === 0) return [];
      // One statement: the given order kept by microseconds after now, after anything
      // queued before.
      const { rows } = await sql<{ id: string }>`
        with voiced as (
          select x.id, given.n
          from unnest(${explainerIds}::bigint[]) with ordinality as given (id, n)
          join concept_explainer x on x.id = given.id and x.status = 'approved'
          join explainer_audio a on a.explainer_id = x.id
        ),
        queued as (
          insert into listen_queue (user_id, explainer_id, added_at)
          select ${userId}, id, clock_timestamp() + n * interval '1 microsecond'
          from voiced
          on conflict (user_id, explainer_id) do nothing
        )
        select id from voiced order by n
      `.execute(db);
      return rows.map((r) => r.id);
    },
    remove: async (userId, explainerId) => {
      const removed = await db
        .deleteFrom("listen_queue")
        .where("user_id", "=", userId)
        .where("explainer_id", "=", explainerId)
        .executeTakeFirst();
      return removed.numDeletedRows > 0n;
    },
    start: async (userId, explainerId) => {
      const found = await voicedExplainers(db)
        .select("x.concept_id")
        .where("x.id", "=", explainerId)
        .executeTakeFirst();
      if (found === undefined) return null;
      // A listen under way (saved, not finished) resumes; otherwise this starts one,
      // from 0 if it was finished before. Each step is one atomic row change, so of two
      // starts at once (a double tap, the web and the app) only one counts as new.
      const restarted = await sql`
        update explainer_listen
        set finished_at = null, position_seconds = 0, updated_at = now()
        where user_id = ${userId} and explainer_id = ${explainerId}
          and finished_at is not null
      `.execute(db);
      if ((restarted.numAffectedRows ?? 0n) > 0n)
        return { conceptId: found.concept_id, new: true };
      const inserted = await sql`
        insert into explainer_listen (user_id, explainer_id)
        values (${userId}, ${explainerId})
        on conflict (user_id, explainer_id) do nothing
      `.execute(db);
      return {
        conceptId: found.concept_id,
        new: (inserted.numAffectedRows ?? 0n) > 0n,
      };
    },
    // Only a listen under way: a save arriving after the finish (the pause the browser
    // fires at the end) or before the start would otherwise misplace it.
    save: async (userId, explainerId, seconds) => {
      const saved = await db
        .updateTable("explainer_listen")
        .set({ position_seconds: seconds, updated_at: sql`now()` })
        .where("user_id", "=", userId)
        .where("explainer_id", "=", explainerId)
        .where("finished_at", "is", null)
        .executeTakeFirst();
      return saved.numUpdatedRows > 0n;
    },
    finish: async (userId, explainerId) => {
      const found = await voicedExplainers(db)
        .select("x.concept_id")
        .where("x.id", "=", explainerId)
        .executeTakeFirst();
      if (found === undefined) return null;
      // LOAD-5: a repeated finish (a retry) changes nothing and isn't counted again.
      const finished = await sql`
        with dequeued as (
          delete from listen_queue
          where user_id = ${userId} and explainer_id = ${explainerId}
        )
        insert into explainer_listen (user_id, explainer_id, finished_at)
        values (${userId}, ${explainerId}, now())
        on conflict (user_id, explainer_id) do update
          set finished_at = now(), position_seconds = 0, updated_at = now()
          where explainer_listen.finished_at is null
      `.execute(db);
      return {
        conceptId: found.concept_id,
        new: (finished.numAffectedRows ?? 0n) > 0n,
      };
    },
  };
}
