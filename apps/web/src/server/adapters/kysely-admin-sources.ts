import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import type { AdminSources } from "../ports";

// Postgres adapter (ADR-0012) for the admin's list of sources. ADR-0058 removed the
// per-source moments switch (P1-W3-S06) it once wrote.
export function kyselyAdminSources(db: Kysely<DB>): AdminSources {
  return {
    async list() {
      const rows = await db
        .selectFrom("source")
        .select(["id", "name", "rights_profile", "active"])
        .orderBy("name")
        .execute();
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        rightsProfile: row.rights_profile,
        active: row.active,
      }));
    },
  };
}
