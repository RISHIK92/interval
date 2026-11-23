import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import {
  Check,
  Interface,
  PRACTICE_TOPICS,
  ResultLine,
  Scenario,
} from "@interval/lld";
import { sql } from "kysely";
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
  pool: z.enum(["practice", "battle"]),
  topic: z.enum(PRACTICE_TOPICS).nullable(),
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
        pool: row.pool,
        topic: row.topic,
      });
      return {
        slug: row.slug,
        title: row.title,
        difficulty: row.difficulty,
        statement: row.statement,
        battleMode: row.battle_mode === "ai" ? "ai" : "human",
        pool: stored.pool,
        topic: stored.topic,
        concepts: row.concepts,
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
    pool: async (battleMode) =>
      (
        await db
          .selectFrom("lld_problem")
          .select("slug")
          .where("battle_mode", "=", battleMode)
          .where("pool", "=", "battle")
          .where("retired_at", "is", null)
          .execute()
      ).map((r) => r.slug),

    practice: async () => {
      const rows = await db
        .selectFrom("lld_problem as p")
        .select([
          "p.slug",
          "p.title",
          "p.difficulty",
          "p.topic",
          // The live concepts' names, in the problem's order; a slug the graph doesn't
          // have (yet) is left out.
          sql<string[]>`coalesce((
            select array_agg(k.name order by c.at)
            from unnest(p.concepts) with ordinality as c(slug, at)
            join concept k on k.slug = c.slug and k.retired_at is null
          ), '{}')`.as("concepts"),
        ])
        .where("p.pool", "=", "practice")
        .where("p.retired_at", "is", null)
        .orderBy("p.difficulty")
        .orderBy("p.title")
        .execute();
      return rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        difficulty: r.difficulty,
        topic: z.enum(PRACTICE_TOPICS).parse(r.topic),
        concepts: r.concepts,
      }));
    },

    save: async (p) => {
      const values = {
        title: p.title,
        difficulty: p.difficulty,
        statement: p.statement,
        battle_mode: p.battleMode,
        pool: p.pool,
        topic: p.topic,
        concepts: p.concepts,
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
      // ADR-0048: a practice problem never moves back to battles, once its tests could
      // have been probed: the conflict's update doesn't apply, and nothing is written.
      const written = await db
        .insertInto("lld_problem")
        .values({ slug: p.slug, ...values })
        .onConflict((oc) =>
          oc
            .column("slug")
            .doUpdateSet(values)
            .where((eb) =>
              eb.or([
                eb("lld_problem.pool", "=", "battle"),
                eb("excluded.pool", "=", "practice"),
              ]),
            ),
        )
        .executeTakeFirst();
      if (written.numInsertedOrUpdatedRows === 0n)
        throw new Error(
          `${p.slug}: a practice problem never moves back to battles`,
        );
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
