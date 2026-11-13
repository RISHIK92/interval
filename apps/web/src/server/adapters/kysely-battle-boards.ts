import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { BattleBoards } from "../ports";

// P5-W33 (§6.7, Q-P5-20): battle boards from the ratings themselves, for players with a
// rated battle this season (by history: the season's reset touches every rating);
// usernames as quick games' boards show them (a guest's name otherwise).
export function kyselyBattleBoards(db: Kysely<DB>): BattleBoards {
  return {
    top: async (league, kind, since, viewer, limit) => {
      const rows =
        kind === "duel"
          ? await sql<{ user_id: string; name: string; rating: number }>`
              select r.user_id, coalesce(n.username, u.name) as name, r.rating
              from battle_rating r
              join app_user u on u.id = r.user_id
              left join player_username n on n.user_id = r.user_id
              where r.league = ${league}
                and exists (select 1 from battle_rating_history h
                  where h.user_id = r.user_id and h.league = r.league
                    and h.at >= ${since})
              order by r.rating desc, r.user_id
              limit ${limit}`.execute(db)
          : await sql<{ user_id: string; name: string; rating: number }>`
              select r.user_id, coalesce(n.username, u.name) as name,
                     r.mu - 3 * r.sigma as rating
              from room_rating r
              join app_user u on u.id = r.user_id
              left join player_username n on n.user_id = r.user_id
              where r.league = ${league}
                and exists (select 1 from room_rating_history h
                  where h.user_id = r.user_id and h.league = r.league
                    and h.at >= ${since})
              order by rating desc, r.user_id
              limit ${limit}`.execute(db);
      return rows.rows.map((r) => ({
        name: r.name,
        rating: r.rating,
        you: r.user_id === viewer,
      }));
    },
  };
}
