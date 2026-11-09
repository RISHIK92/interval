import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { AdminPronunciations } from "../ports";

// P4-W22-S02 (TTS-2): the pronunciation dictionary on the admin page.
export function kyselyAdminPronunciations(db: Kysely<DB>): AdminPronunciations {
  return {
    list: async () => {
      const rows = await db
        .selectFrom("pronunciation")
        .select(["id", "term", "say", "origin"])
        .orderBy(sql`lower(term)`)
        .execute();
      return rows.map((r) => ({
        ...r,
        origin: r.origin === "admin" ? "admin" : "seed",
      }));
    },
    add: async (term, say, by) => {
      // The unique index on lower(term) decides: a term in any case is taken.
      const added = await db
        .insertInto("pronunciation")
        .values({ term, say, origin: "admin", added_by: by })
        .onConflict((oc) => oc.expression(sql`lower(term)`).doNothing())
        .returning("id")
        .executeTakeFirst();
      return added === undefined ? "taken" : "added";
    },
    remove: async (id) => {
      const gone = await db
        .deleteFrom("pronunciation")
        .where("id", "=", id)
        .where("origin", "=", "admin")
        .executeTakeFirst();
      return gone.numDeletedRows > 0n;
    },
  };
}
