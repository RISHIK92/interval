import { Caption } from "@interval/api-client";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import type { AdminScenes, PendingScene } from "../ports";

// P4.5-W26-S02 (AI-1, Q-P4.5-03): the owner's review of drafted scene timelines, each
// with the captions of the voiced explainer it was drawn over (its steps' anchors).
const Captions = z.array(Caption);

export function kyselyAdminScenes(db: Kysely<DB>): AdminScenes {
  const pending = () =>
    db
      .selectFrom("explainer_scene as s")
      .innerJoin("concept_explainer as x", "x.id", "s.explainer_id")
      .innerJoin("concept as c", "c.id", "x.concept_id")
      .innerJoin("explainer_audio as a", "a.explainer_id", "x.id")
      .select([
        "s.id",
        "c.name as concept",
        "s.scene_key as key",
        "s.generator_model as model",
        "a.captions",
      ])
      .where("s.status", "=", "pending");
  const review = (r: {
    id: string;
    concept: string;
    key: string;
    model: string;
    captions: unknown;
  }): PendingScene => ({ ...r, captions: Captions.parse(r.captions) });

  return {
    pending: async () =>
      (await pending().orderBy("s.created_at").orderBy("s.id").execute()).map(
        review,
      ),
    scene: async (id) => {
      const row = await pending().where("s.id", "=", id).executeTakeFirst();
      return row === undefined ? null : review(row);
    },
    decide: async (id, decision, by) => {
      const done = await db
        .updateTable("explainer_scene")
        .set({ status: decision, decided_by: by, decided_at: sql<Date>`now()` })
        .where("id", "=", id)
        .where("status", "=", "pending")
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },
  };
}
