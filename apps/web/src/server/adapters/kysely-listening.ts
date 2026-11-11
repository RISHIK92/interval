import { Caption, type ListenExplainer } from "@interval/api-client";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import type { Listening } from "../ports";

// P4-W23-S01 (§5G, §5I): the audio queue. Only approved explainers with audio are ever
// offered, queued or played; a citation whose section is gone is left out of the
// sources rather than shown without its link (as the admin page does).
const Cited = z.array(
  z.object({ moment_id: z.union([z.number(), z.string()]) }),
);
const cited = (raw: unknown) =>
  Cited.parse(raw).map((c) => String(c.moment_id));
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
    const ids = [...new Set(rows.flatMap((r) => cited(r.citations)))];
    const sections =
      ids.length === 0
        ? []
        : await db
            .selectFrom("moment as m")
            .innerJoin("content_item as ci", "ci.id", "m.content_item_id")
            .select(["m.id", "m.title", "ci.title as article", "m.link"])
            .where("m.id", "in", ids)
            .execute();
    const byId = new Map(sections.map((s) => [s.id, s]));
    return rows.map((r) => ({
      explainerId: r.explainerId,
      conceptId: r.conceptId,
      concept: r.concept,
      src: `/${r.playlist}`,
      durationSeconds: Number(r.duration),
      positionSeconds: Number(r.position ?? 0),
      sources: cited(r.citations).flatMap((id) => {
        const m = byId.get(id);
        if (m === undefined) return [];
        const title =
          m.title === m.article ? m.article : `${m.title} — ${m.article}`;
        return [{ title, href: m.link }];
      }),
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
    voiced: async (itemId, momentId) => {
      const rows = await voicedExplainers(db)
        .select("x.id")
        .where(
          "x.concept_id",
          "in",
          momentId === null
            ? db
                .selectFrom("item_concept")
                .select("concept_id")
                .where("content_item_id", "=", itemId)
            : db
                .selectFrom("moment_concept as mc")
                .innerJoin("moment as m", "m.id", "mc.moment_id")
                .select("mc.concept_id")
                .where("m.id", "=", momentId)
                .where("m.content_item_id", "=", itemId),
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
      if (explainerIds.length === 0) return;
      // One statement: the given order kept by microseconds after now, after anything
      // queued before.
      await sql`
        insert into listen_queue (user_id, explainer_id, added_at)
        select ${userId}, x.id, clock_timestamp() + given.n * interval '1 microsecond'
        from unnest(${explainerIds}::bigint[]) with ordinality as given (id, n)
        join concept_explainer x on x.id = given.id and x.status = 'approved'
        join explainer_audio a on a.explainer_id = x.id
        on conflict (user_id, explainer_id) do nothing
      `.execute(db);
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
