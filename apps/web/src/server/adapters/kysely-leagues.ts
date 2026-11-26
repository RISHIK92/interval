import type { DB, LeagueTier } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { LeagueCohort, LeagueRow, Leagues } from "../ports";

// ADR-0045: weekly leagues as the worker keeps them. Ranks and how many move come from
// the database's views (league_standing, league_cohort_moves), the same the week's
// close applies, so the zones shown are the zones that count.
export function kyselyLeagues(db: Kysely<DB>): Leagues {
  const tierOf = async (userId: string): Promise<LeagueTier | null> =>
    (
      await db
        .selectFrom("league_player")
        .select("tier")
        .where("user_id", "=", userId)
        .executeTakeFirst()
    )?.tier ?? null;

  return {
    standing: async (userId, weekStart, todayFrom) => {
      const placed = await db
        .selectFrom("league_member as m")
        .innerJoin("league_week as w", "w.id", "m.week_id")
        .innerJoin("league_cohort_moves as c", "c.cohort_id", "m.cohort_id")
        .select(["m.cohort_id", "c.tier", "c.size", "c.up", "c.down"])
        .where("m.user_id", "=", userId)
        .where("w.starts_on", "=", sql<Date>`${weekStart}::date`)
        .executeTakeFirst();
      if (placed?.cohort_id == null || placed.tier === null)
        return { tier: (await tierOf(userId)) ?? "bronze", cohort: null };
      const { rows } = await sql<{
        user_id: string;
        username: string | null;
        rank: number;
        points: number;
        matches: number;
        battles: number;
        checkpoints: number;
        today: number;
      }>`
        select s.user_id, n.username, s.rank, s.points,
          (count(p.id) filter (where p.reason in ('match', 'bot_match')))::int
            as matches,
          (count(p.id) filter (where p.reason = 'battle'))::int as battles,
          (count(p.id) filter (where p.reason = 'checkpoint'))::int as checkpoints,
          coalesce(sum(p.points) filter (where p.at >= ${todayFrom}), 0)::int
            as today
        from league_standing s
        left join player_username n on n.user_id = s.user_id
        left join league_points p
          on p.user_id = s.user_id and p.week_id = s.week_id
        where s.cohort_id = ${placed.cohort_id}
        group by s.user_id, n.username, s.rank, s.points
        order by s.rank
      `.execute(db);
      const cohort: LeagueCohort = {
        size: placed.size ?? rows.length,
        up: placed.up ?? 0,
        down: placed.down ?? 0,
        rows: rows.map((r): LeagueRow => ({
          userId: r.user_id,
          username: r.username,
          rank: r.rank,
          points: r.points,
          matches: r.matches,
          battles: r.battles,
          checkpoints: r.checkpoints,
          today: r.today,
        })),
      };
      return { tier: placed.tier, cohort };
    },

    pointsOf: async (userIds, weekStart) =>
      userIds.length === 0
        ? []
        : (
            await db
              .selectFrom("league_points as p")
              .innerJoin("league_week as w", "w.id", "p.week_id")
              .select([
                "p.user_id as userId",
                sql<number>`sum(p.points)::int`.as("points"),
              ])
              .where("p.user_id", "in", userIds)
              .where("w.starts_on", "=", sql<Date>`${weekStart}::date`)
              .groupBy("p.user_id")
              .having(sql<boolean>`sum(p.points) > 0`)
              .execute()
          ).map((r) => ({ userId: r.userId, points: r.points })),

    tier: tierOf,
  };
}
