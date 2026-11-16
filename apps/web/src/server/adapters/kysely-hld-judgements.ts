import type { DB } from "@interval/db";
import { JudgeInput, Levels } from "@interval/hld";
import { type Kysely, type Selectable, sql } from "kysely";
import type { HldJudgement, HldJudgements } from "../ports";

// P6-W41 (CANVAS-6, Q-P6-05): HLD judgements, appeals and calibration grades. The
// worker writes levels and advice; levels are checked against packages/hld's schema as
// they're read, so a malformed row shows as unjudged, never as wrong points.
const APPEAL_DAYS = 7;
const STALE = "15 minutes"; // far past the worker's last try

type Row = Selectable<DB["hld_judgement"]>;

const levelsOf = (value: unknown) => {
  const parsed = Levels.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const toJudgement = (r: Row): HldJudgement => ({
  id: r.id,
  problemSlug: r.problem_slug,
  status: r.status as HldJudgement["status"], // the column's check allows only these
  baselinePassed: r.baseline_passed,
  levels: levelsOf(r.levels),
  coach: r.coach,
  requestedAt: r.requested_at,
  appealedAt: r.appealed_at,
  ownerLevels: levelsOf(r.owner_levels),
});

export function kyselyHldJudgements(db: Kysely<DB>): HldJudgements {
  return {
    request: async (userId, slug, input, baselinePassed, matchId) => {
      const json = JSON.stringify(input);
      // A request still pending after STALE was lost (its message dropped, or its
      // worker gone after its last try): it no longer blocks asking again.
      await db
        .updateTable("hld_judgement")
        .set({ status: "unavailable" })
        .where("user_id", "=", userId)
        .where("problem_slug", "=", slug)
        .where("status", "=", "pending")
        .where("requested_at", "<", sql<Date>`now() - ${STALE}::interval`)
        .execute();
      // The same design again gets the feedback it already has, waiting or written,
      // rather than paying the model for it twice (OPS-4).
      const same = await db
        .selectFrom("hld_judgement")
        .select("id")
        .where("user_id", "=", userId)
        .where("problem_slug", "=", slug)
        .where("status", "<>", "unavailable")
        .where(sql<boolean>`match_id is not distinct from ${matchId}::uuid`)
        .where(sql<boolean>`input = ${json}::jsonb`)
        .orderBy("requested_at", "desc")
        .limit(1)
        .executeTakeFirst();
      if (same !== undefined) return { id: same.id, created: false };
      // Twice: a waiting request can finish between the insert's conflict and the
      // look-up, and then there's room for this one.
      for (let attempt = 0; attempt < 2; attempt++) {
        const created = await db
          .insertInto("hld_judgement")
          .values({
            user_id: userId,
            problem_slug: slug,
            input: json,
            baseline_passed: baselinePassed,
            match_id: matchId,
          })
          .onConflict((c) =>
            c
              .columns(["user_id", "problem_slug"])
              .where("status", "=", "pending")
              .where("match_id", "is", null)
              .doNothing(),
          )
          .returning("id")
          .executeTakeFirst();
        if (created !== undefined) return { id: created.id, created: true };
        const waiting = await db
          .selectFrom("hld_judgement")
          .select("id")
          .where("user_id", "=", userId)
          .where("problem_slug", "=", slug)
          .where("status", "=", "pending")
          .where(sql<boolean>`match_id is not distinct from ${matchId}::uuid`)
          .executeTakeFirst();
        if (waiting !== undefined) return { id: waiting.id, created: false };
      }
      throw new Error(
        "hld: a judgement request kept finishing as it was asked",
      );
    },

    drop: async (id) => {
      await db
        .deleteFrom("hld_judgement")
        .where("id", "=", id)
        .where("status", "=", "pending")
        .execute();
    },

    latest: async (userId, slug) => {
      const row = await db
        .selectFrom("hld_judgement")
        .selectAll()
        .where("user_id", "=", userId)
        .where("problem_slug", "=", slug)
        .orderBy("requested_at", "desc")
        .limit(1)
        .executeTakeFirst();
      return row === undefined ? null : toJudgement(row);
    },

    ofMatch: async (matchId) => {
      const rows = await db
        .selectFrom("hld_judgement")
        .selectAll()
        .where("match_id", "=", matchId)
        .execute();
      return rows.map((r) => ({ ...toJudgement(r), userId: r.user_id }));
    },

    get: async (id, userId) => {
      const row = await db
        .selectFrom("hld_judgement")
        .selectAll()
        .where("id", "=", id)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row === undefined ? null : toJudgement(row);
    },

    appeal: async (id, userId, reason, now) => {
      // One statement: once, in time, and only of a judgement with levels.
      const done = await db
        .updateTable("hld_judgement")
        .set({ appeal_reason: reason, appealed_at: now })
        .where("id", "=", id)
        .where("user_id", "=", userId)
        .where("appealed_at", "is", null)
        .where("levels", "is not", null)
        .where(
          "requested_at",
          ">",
          sql<Date>`${now}::timestamptz - make_interval(days => ${APPEAL_DAYS})`,
        )
        .executeTakeFirst();
      if (done.numUpdatedRows > 0n) return "appealed";
      const row = await db
        .selectFrom("hld_judgement")
        .select(["appealed_at", "levels"])
        .where("id", "=", id)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      if (row === undefined) return null;
      if (row.appealed_at !== null) return "twice";
      if (row.levels === null) return "not_judged";
      return "late";
    },

    openAppeals: async () => {
      const rows = await db
        .selectFrom("hld_judgement as j")
        .innerJoin("app_user as u", "u.id", "j.user_id")
        .leftJoin("player_username as n", "n.user_id", "j.user_id")
        .selectAll("j")
        .select(sql<string>`coalesce(n.username, u.name)`.as("player"))
        .where("j.appealed_at", "is not", null)
        .where("j.resolved_at", "is", null)
        .orderBy("j.appealed_at")
        .execute();
      return rows.map((r) => ({
        ...toJudgement(r),
        player: r.player,
        reason: r.appeal_reason ?? "",
        input: JudgeInput.parse(r.input),
      }));
    },

    resolve: async (id, levels, by) => {
      const done = await db
        .updateTable("hld_judgement")
        .set({
          owner_levels: JSON.stringify(levels),
          resolved_at: new Date(),
          resolved_by: by,
        })
        .where("id", "=", id)
        .where("appealed_at", "is not", null)
        .where("resolved_at", "is", null)
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },

    calibrationGrades: async () => {
      const rows = await db
        .selectFrom("hld_calibration_grade")
        .select(["candidate_id", "criterion_id", "level"])
        .execute();
      const grades = new Map<string, Record<string, number>>();
      for (const r of rows)
        grades.set(r.candidate_id, {
          ...grades.get(r.candidate_id),
          [r.criterion_id]: r.level,
        });
      return grades;
    },

    grade: async (candidateId, levels, by) => {
      const rows = Object.entries(levels).map(([criterion, level]) => ({
        candidate_id: candidateId,
        criterion_id: criterion,
        level,
        graded_by: by,
      }));
      if (rows.length === 0) return;
      await db
        .insertInto("hld_calibration_grade")
        .values(rows)
        .onConflict((c) =>
          c.columns(["candidate_id", "criterion_id"]).doUpdateSet((eb) => ({
            level: eb.ref("excluded.level"),
            graded_by: eb.ref("excluded.graded_by"),
            graded_at: new Date(),
          })),
        )
        .execute();
    },
  };
}
