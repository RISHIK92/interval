import type { DB } from "@interval/db";
import { type Kysely, type Selectable, sql } from "kysely";
import type { HldMatch, HldMatches, HldSeat, League } from "../ports";

// P6-W42 (§6.4, Q-P6-06, ADR-0043): HLD matches in Postgres. Every step that must happen
// once (a submission, closing, scoring) is one conditional statement, so two requests
// moving the same match on can't both do it.
const START_RATING = 1500; // Glicko-2's, as the worker seeds a first rating

// Inside a caller's transaction (a test's rollback), run there; otherwise in a new one.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

const num = (v: string | number | null) => (v === null ? null : Number(v));

const toMatch = (r: Selectable<DB["hld_match"]>): HldMatch => ({
  id: r.id,
  family: r.family,
  league: r.league as League, // the column's check allows only these
  seed: r.seed,
  unrated: r.unrated,
  windowAt: r.window_at,
  startedAt: r.started_at,
  deadlineAt: r.deadline_at,
  closedAt: r.closed_at,
  scoredAt: r.scored_at,
  rubricIncluded: r.rubric_included,
  ratedAt: r.rated_at,
});

export function kyselyHldMatches(db: Kysely<DB>): HldMatches {
  return {
    create: async (players, variant, options) =>
      inTransaction(db, async (trx) => {
        const match = await trx
          .insertInto("hld_match")
          .values({
            family: variant.family,
            league: variant.league,
            seed: variant.seed,
            unrated: options.unrated,
            window_at: options.windowAt,
            deadline_at: sql<Date>`now() + make_interval(mins => ${options.minutes})`,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("hld_match_player")
          .values(players.map((user_id) => ({ match_id: match.id, user_id })))
          .execute();
        return match.id;
      }),

    get: async (id) => {
      const match = await db
        .selectFrom("hld_match")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      if (match === undefined) return null;
      const seats = await db
        .selectFrom("hld_match_player as p")
        .innerJoin("app_user as u", "u.id", "p.user_id")
        .leftJoin("player_username as n", "n.user_id", "p.user_id")
        .select([
          "p.user_id",
          sql<string>`coalesce(n.username, u.name)`.as("player"),
          "p.submitted_at",
          "p.auto_submitted",
          "p.simulation_points",
          "p.baseline_passed",
          "p.speed_points",
          "p.judgement_id",
          "p.design",
          "p.total",
          "p.place",
        ])
        .where("p.match_id", "=", id)
        .orderBy("p.user_id")
        .execute();
      return {
        match: toMatch(match),
        seats: seats.map((s): HldSeat => ({
          userId: s.user_id,
          player: s.player,
          submittedAt: s.submitted_at,
          autoSubmitted: s.auto_submitted,
          simulationPoints: num(s.simulation_points),
          baselinePassed: s.baseline_passed,
          speedPoints: num(s.speed_points),
          judgementId: s.judgement_id,
          design: s.design,
          total: num(s.total),
          place: s.place,
        })),
      };
    },

    saveVersion: async (id, userId, design, base) => {
      // One statement: the player's, still open and not submitted, and over the latest
      // version; the primary key refuses a second save over the same one.
      const saved = await sql<{ version: number }>`
        insert into hld_design_version (match_id, user_id, version, design)
        select ${id}::uuid, ${userId}, ${base + 1}, ${JSON.stringify(design)}::jsonb
        where exists (
            select 1 from hld_match m
            join hld_match_player p on p.match_id = m.id
            where m.id = ${id}::uuid and p.user_id = ${userId}
              and m.closed_at is null and m.deadline_at > now()
              and p.submitted_at is null)
          and coalesce((select max(version) from hld_design_version
              where match_id = ${id}::uuid and user_id = ${userId}), 0) = ${base}
        on conflict do nothing
        returning version`.execute(db);
      return saved.rows[0]?.version ?? null;
    },

    latestVersion: async (id, userId) => {
      const row = await db
        .selectFrom("hld_design_version")
        .select(["design", "version"])
        .where("match_id", "=", id)
        .where("user_id", "=", userId)
        .orderBy("version", "desc")
        .limit(1)
        .executeTakeFirst();
      return row === undefined
        ? null
        : { design: row.design, version: row.version };
    },

    submit: async (id, userId, s) => {
      let update = db
        .updateTable("hld_match_player")
        .set({
          submitted_at: s.at,
          auto_submitted: s.auto,
          design: JSON.stringify(s.design),
          simulation_points: String(s.simulationPoints),
          baseline_passed: s.baselinePassed,
          speed_points: String(s.speedPoints),
        })
        .where("match_id", "=", id)
        .where("user_id", "=", userId)
        .where("submitted_at", "is", null);
      // The player's own submission only while the match is open, by the database's
      // clock: one arriving after the deadline is the deadline's.
      if (!s.auto)
        update = update.where((eb) =>
          eb.exists(
            eb
              .selectFrom("hld_match")
              .select("id")
              .where("id", "=", id)
              .where("closed_at", "is", null)
              .where("deadline_at", ">", sql<Date>`now()`),
          ),
        );
      const done = await update.executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },

    claimJudgement: async (id, userId, judgementId) => {
      const done = await db
        .updateTable("hld_match_player")
        .set({ judgement_id: judgementId })
        .where("match_id", "=", id)
        .where("user_id", "=", userId)
        .where("submitted_at", "is not", null)
        .where("judgement_id", "is", null)
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },

    releaseJudgement: async (id, userId, judgementId) => {
      await db
        .updateTable("hld_match_player")
        .set({ judgement_id: null })
        .where("match_id", "=", id)
        .where("user_id", "=", userId)
        .where("judgement_id", "=", judgementId)
        .execute();
    },

    close: async (id, at) => {
      const done = await db
        .updateTable("hld_match")
        .set({ closed_at: at })
        .where("id", "=", id)
        .where("closed_at", "is", null)
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },

    score: async (id, rubricIncluded, standings, at) =>
      inTransaction(db, async (trx) => {
        const done = await trx
          .updateTable("hld_match")
          .set({ scored_at: at, rubric_included: rubricIncluded })
          .where("id", "=", id)
          .where("closed_at", "is not", null)
          .where("scored_at", "is", null)
          .executeTakeFirst();
        if (done.numUpdatedRows === 0n) return false;
        for (const s of standings)
          await trx
            .updateTable("hld_match_player")
            .set({ total: String(s.total), place: s.place })
            .where("match_id", "=", id)
            .where("user_id", "=", s.userId)
            .execute();
        return true;
      }),

    ratingOf: async (userId, league) => {
      const row = await db
        .selectFrom("hld_rating")
        .select("rating")
        .where("user_id", "=", userId)
        .where("league", "=", league)
        .executeTakeFirst();
      return row?.rating ?? START_RATING;
    },

    ratingChanges: async (id) => {
      const [duel, room] = await Promise.all([
        db
          .selectFrom("hld_rating_history")
          .select([
            "user_id",
            sql<number>`rating_after - rating_before`.as("change"),
          ])
          .where("match_id", "=", id)
          .execute(),
        db
          .selectFrom("hld_room_rating_history")
          .select(["user_id", sql<number>`mu_after - mu_before`.as("change")])
          .where("match_id", "=", id)
          .execute(),
      ]);
      return new Map([...duel, ...room].map((r) => [r.user_id, r.change]));
    },

    unscoredFor: async (userId) => {
      const rows = await db
        .selectFrom("hld_match as m")
        .innerJoin("hld_match_player as p", "p.match_id", "m.id")
        .select("m.id")
        .where("p.user_id", "=", userId)
        .where("m.scored_at", "is", null)
        .execute();
      return rows.map((r) => r.id);
    },
  };
}
