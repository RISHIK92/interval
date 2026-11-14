import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import type { HldPracticeDesigns } from "../ports";

// P6-W39 (ADR-0042 PROPOSED, Q-P6-03): practice designs, one per player per problem.
// Each save names the version it was made over; one statement checks and writes it, so
// two tabs can't both save over the same version.
export function kyselyHldPracticeDesigns(db: Kysely<DB>): HldPracticeDesigns {
  return {
    load: async (userId, slug) => {
      const row = await db
        .selectFrom("hld_practice_design")
        .select(["design", "version"])
        .where("user_id", "=", userId)
        .where("problem_slug", "=", slug)
        .executeTakeFirst();
      return row === undefined
        ? null
        : { design: row.design, version: row.version };
    },

    save: async (userId, slug, design, base) => {
      const json = JSON.stringify(design);
      const row =
        base === 0
          ? await db
              .insertInto("hld_practice_design")
              .values({
                user_id: userId,
                problem_slug: slug,
                version: 1,
                design: json,
              })
              .onConflict((c) => c.doNothing())
              .returning("version")
              .executeTakeFirst()
          : await db
              .updateTable("hld_practice_design")
              .set((eb) => ({
                version: eb("version", "+", 1),
                design: json,
                saved_at: new Date(),
              }))
              .where("user_id", "=", userId)
              .where("problem_slug", "=", slug)
              .where("version", "=", base)
              .returning("version")
              .executeTakeFirst();
      return row?.version ?? null;
    },
  };
}
