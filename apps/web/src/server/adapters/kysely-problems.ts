import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import { Check, Interface, ResultLine, Scenario } from "@interval/lld";
import { z } from "zod";
import type { ProblemStore } from "../ports";

const Stored = z.object({
  interface: Interface,
  checks: z.array(Check),
  limits: z.object({ seconds: z.int(), memoryMB: z.int() }),
  visible: z.array(
    z.object({ scenario: Scenario, results: z.array(ResultLine) }),
  ),
  extensionInterface: Interface.nullable(),
});

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
    get: async (slug) => {
      const row = await db
        .selectFrom("lld_problem")
        .selectAll()
        .where("slug", "=", slug)
        .where("retired_at", "is", null)
        .executeTakeFirst();
      if (row === undefined) return null;
      // Parsed at the database boundary with the contract save wrote them from.
      const stored = Stored.parse({
        interface: row.interface,
        checks: row.checks,
        limits: row.limits,
        visible: row.visible,
        extensionInterface: row.extension_interface,
      });
      return {
        slug: row.slug,
        title: row.title,
        difficulty: row.difficulty,
        statement: row.statement,
        league: row.league === "ai" ? "ai" : "human",
        interface: stored.interface,
        checks: stored.checks,
        limits: stored.limits,
        visible: stored.visible,
        extension:
          row.extension_statement === null || stored.extensionInterface === null
            ? null
            : {
                statement: row.extension_statement,
                interface: stored.extensionInterface,
              },
        interviewerNotes: row.interviewer_notes,
        privateKey: row.private_key,
        contentHash: row.content_hash,
      };
    },
    pool: async (league) =>
      (
        await db
          .selectFrom("lld_problem")
          .select("slug")
          .where("league", "=", league)
          .where("retired_at", "is", null)
          .execute()
      ).map((r) => r.slug),

    save: async (p) => {
      const values = {
        title: p.title,
        difficulty: p.difficulty,
        statement: p.statement,
        league: p.league,
        interviewer_notes: p.interviewerNotes,
        // jsonb as JSON text: pg would send a JS array as a Postgres array, not JSON.
        interface: JSON.stringify(p.interface),
        checks: JSON.stringify(p.checks),
        limits: JSON.stringify(p.limits),
        visible: JSON.stringify(p.visible),
        extension_statement: p.extension?.statement ?? null,
        extension_interface:
          p.extension === null ? null : JSON.stringify(p.extension.interface),
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
