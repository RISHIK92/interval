import type { DB } from "@interval/db";
import type { Kysely, Selectable } from "kysely";
import type { LldPractice, PracticeBest, PracticeCode } from "../ports";

// ADR-0048 (Q-WD-28): LLD practice code, one copy per player, problem and language. Each
// save names the version it was made over; one statement checks and writes it, so two
// tabs can't both save over the same version (as hld_practice_design). The bests are the
// worker's (lld_practice_best), read here.
type BestRow = Selectable<DB["lld_practice_best"]>;

function bestOf(row: BestRow): PracticeBest {
  return {
    slug: row.problem_slug,
    points: row.points,
    layers: {
      visible: { passed: row.visible_passed, total: row.visible_total },
      hidden: { passed: row.hidden_passed, total: row.hidden_total },
      concurrency: {
        passed: row.concurrency_passed,
        total: row.concurrency_total,
      },
      extension: { passed: row.extension_passed, total: row.extension_total },
    },
    language: row.language,
    achievedAt: row.achieved_at,
    submits: row.submits,
  };
}

export function kyselyLldPractice(db: Kysely<DB>): LldPractice {
  return {
    loadCode: async (userId, slug) => {
      const rows = await db
        .selectFrom("lld_practice_code")
        .select(["language", "code", "version"])
        .where("user_id", "=", userId)
        .where("problem_slug", "=", slug)
        .orderBy("saved_at")
        .execute();
      return new Map(
        rows.map((r) => [r.language, { code: r.code, version: r.version }]),
      );
    },

    saveCode: async (userId, slug, language, code, base) => {
      const row =
        base === 0
          ? await db
              .insertInto("lld_practice_code")
              .values({
                user_id: userId,
                problem_slug: slug,
                language,
                code,
                version: 1,
              })
              .onConflict((c) => c.doNothing())
              .returning("version")
              .executeTakeFirst()
          : await db
              .updateTable("lld_practice_code")
              .set((eb) => ({
                version: eb("version", "+", 1),
                code,
                saved_at: new Date(),
              }))
              .where("user_id", "=", userId)
              .where("problem_slug", "=", slug)
              .where("language", "=", language)
              .where("version", "=", base)
              .returning("version")
              .executeTakeFirst();
      return row?.version ?? null;
    },

    best: async (userId) => {
      const rows = await db
        .selectFrom("lld_practice_best")
        .selectAll()
        .where("user_id", "=", userId)
        .execute();
      return new Map(rows.map((r) => [r.problem_slug, bestOf(r)]));
    },

    bestFor: async (userId, slug) => {
      const row = await db
        .selectFrom("lld_practice_best")
        .selectAll()
        .where("user_id", "=", userId)
        .where("problem_slug", "=", slug)
        .executeTakeFirst();
      return row === undefined ? null : bestOf(row);
    },
  };
}

// The in-memory fake (ADR-0012): code as the contract says; bests as a test sets them.
export function memoryLldPractice(
  bests: Map<string, Map<string, PracticeBest>> = new Map(),
): LldPractice {
  const code = new Map<string, Map<string, PracticeCode>>();
  return {
    loadCode: (userId, slug) =>
      Promise.resolve(new Map(code.get(`${userId} ${slug}`))),
    saveCode: (userId, slug, language, text, base) => {
      const key = `${userId} ${slug}`;
      const saved = code.get(key) ?? new Map<string, PracticeCode>();
      if ((saved.get(language)?.version ?? 0) !== base)
        return Promise.resolve(null);
      saved.set(language, { code: text, version: base + 1 });
      code.set(key, saved);
      return Promise.resolve(base + 1);
    },
    best: (userId) => Promise.resolve(new Map(bests.get(userId))),
    bestFor: (userId, slug) =>
      Promise.resolve(bests.get(userId)?.get(slug) ?? null),
  };
}
