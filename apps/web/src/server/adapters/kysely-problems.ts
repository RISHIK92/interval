import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import type { ProblemStore } from "../ports";

// P5-W31-S01 (LLDQ-4): LLD battle problems in Postgres, by slug.
export function kyselyProblemStore(db: Kysely<DB>): ProblemStore {
  return {
    hashes: async () => {
      const rows = await db
        .selectFrom("lld_problem")
        .select(["slug", "content_hash"])
        .where("retired_at", "is", null)
        .execute();
      return new Map(rows.map((r) => [r.slug, r.content_hash]));
    },
    save: async (p) => {
      const values = {
        title: p.title,
        difficulty: p.difficulty,
        statement: p.statement,
        // jsonb as JSON text: pg would send a JS array as a Postgres array, not JSON.
        interface: JSON.stringify(p.interface),
        checks: JSON.stringify(p.checks),
        limits: JSON.stringify(p.limits),
        visible: JSON.stringify(p.visible),
        private_key: p.privateKey,
        content_hash: p.contentHash,
        retired_at: null,
        loaded_at: new Date(),
      };
      await db
        .insertInto("lld_problem")
        .values({ slug: p.slug, ...values })
        .onConflict((oc) => oc.column("slug").doUpdateSet(values))
        .execute();
    },
    retire: async (slugs) => {
      await db
        .updateTable("lld_problem")
        .set({ retired_at: new Date() })
        .where("slug", "in", slugs)
        .where("retired_at", "is", null)
        .execute();
    },
  };
}
