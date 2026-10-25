import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { AdminSources, SourceSwitch } from "../ports";

// Postgres adapter (ADR-0012) for the per-source moments switch (P1-W3-S06).

const COLUMNS = [
  "id",
  "name",
  "rights_profile",
  "active",
  "moments_seeded",
  "moments_switched_off",
  "moments_enabled",
] as const;

function toSwitch(row: {
  id: string;
  name: string;
  rights_profile: string;
  active: boolean;
  moments_seeded: boolean;
  moments_switched_off: boolean;
  moments_enabled: boolean;
}): SourceSwitch {
  return {
    id: row.id,
    name: row.name,
    rightsProfile: row.rights_profile,
    active: row.active,
    momentsSeeded: row.moments_seeded,
    momentsSwitchedOff: row.moments_switched_off,
    momentsEnabled: row.moments_enabled,
  };
}

export function kyselyAdminSources(db: Kysely<DB>): AdminSources {
  return {
    async list() {
      const rows = await db
        .selectFrom("source")
        .select(COLUMNS)
        .orderBy("name")
        .execute();
      return rows.map(toSwitch);
    },

    async get(id) {
      if (!/^\d{1,18}$/.test(id)) return null;
      const row = await db
        .selectFrom("source")
        .select(COLUMNS)
        .where("id", "=", id)
        .executeTakeFirst();
      return row === undefined ? null : toSwitch(row);
    },

    async setMomentsSwitchedOff(id, off, by) {
      // One update: the purge trigger sees moments_enabled change with the switch.
      await db
        .updateTable("source")
        .set({
          moments_switched_off: off,
          moments_enabled: sql<boolean>`moments_seeded and not ${off}`,
          moments_switched_by: by,
          moments_switched_at: sql`now()`,
        })
        .where("id", "=", id)
        .execute();
    },

    async fullTextItemIds(id) {
      const rows = await db
        .selectFrom("content_item as ci")
        .innerJoin(
          "content_item_private_text as pt",
          "pt.content_item_id",
          "ci.id",
        )
        .select("ci.id")
        .where("ci.source_id", "=", id)
        .execute();
      return rows.map((r) => r.id);
    },
  };
}
