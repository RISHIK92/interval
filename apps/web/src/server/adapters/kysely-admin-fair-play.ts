import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { type AdminFairPlay, GAME_MODES } from "../ports";

// P3-W18-S02 (§6.9, Q-P3-20; owner, 2026-11-05): the review of fair-play flags the
// worker raised. A penalty removes the rating the match gained the player (a loss
// stays; the opponent is untouched) and their ghost run of it; the account is never
// touched.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

// As the worker stored them (services/game/fairplay.go).
const Signals = z.array(
  z.object({
    kind: z.enum(["speed", "focus", "paste", "away"]),
    round: z.number().int(),
    ms: z.number().int().nullable(),
    chars: z.number().int().optional(),
  }),
);
const Mode = z.enum([...GAME_MODES, "battle"]);

export function kyselyAdminFairPlay(db: Kysely<DB>): AdminFairPlay {
  return {
    pending: async () => {
      const rows = await db
        .selectFrom("fair_play_flag as f")
        .innerJoin("game_match as m", "m.id", "f.match_id")
        .innerJoin("app_user as u", "u.id", "f.user_id")
        .leftJoin("player_username as n", "n.user_id", "f.user_id")
        .leftJoin("game_match_player as p", (join) =>
          join
            .onRef("p.match_id", "=", "f.match_id")
            .onRef("p.user_id", "=", "f.user_id"),
        )
        .leftJoin("rating_history as h", (join) =>
          join
            .onRef("h.match_id", "=", "f.match_id")
            .onRef("h.user_id", "=", "f.user_id"),
        )
        // P5-W32-S01a: a battle's gain is in its own history.
        .leftJoin("battle_rating_history as bh", (join) =>
          join
            .onRef("bh.match_id", "=", "f.match_id")
            .onRef("bh.user_id", "=", "f.user_id"),
        )
        .select([
          "f.id",
          "f.user_id",
          "f.match_id",
          "m.mode",
          sql<Date>`coalesce(m.finished_at, f.created_at)`.as("played_at"),
          sql<string>`coalesce(n.username, u.name)`.as("player"),
          sql`coalesce(p.signals, '[]'::jsonb)`.as("signals"),
          // greatest() skips nulls: the coalesce goes inside it.
          sql<number>`greatest(0, coalesce(h.rating_after - h.rating_before,
            bh.rating_after - bh.rating_before, 0))`.as("gain"),
        ])
        .where("f.decision", "is", null)
        .orderBy("f.created_at")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        player: r.player,
        matchId: r.match_id,
        mode: Mode.parse(r.mode),
        playedAt: r.played_at,
        signals: Signals.parse(r.signals),
        gain: r.gain,
      }));
    },

    decide: (flagId, adminUserId, decision) =>
      inTransaction(db, async (trx) => {
        // The player first, as a guest's sign-in locks it (mergeGuest) before it
        // moves the flags and deletes the guest: never a deadlock with one.
        await sql`select 1 from app_user where id = (
          select user_id from fair_play_flag where id = ${flagId}) for share`.execute(
          trx,
        );
        const flag = await trx
          .selectFrom("fair_play_flag")
          .select(["match_id", "user_id"])
          .where("id", "=", flagId)
          .where("decision", "is", null)
          .forUpdate()
          .executeTakeFirst();
        if (flag === undefined) return null;
        let penalty: number | null = null;
        if (decision === "penalize") {
          const match = await trx
            .selectFrom("game_match")
            .select(["mode", "league"])
            .where("id", "=", flag.match_id)
            .executeTakeFirstOrThrow();
          if (match.mode === "battle") {
            penalty = await penalizeBattle(trx, flag, match.league);
          } else {
            // Locked like a rating update, so a match rated meanwhile can't be lost.
            const held = await trx
              .selectFrom("player_rating")
              .select("user_id")
              .where("user_id", "=", flag.user_id)
              .forUpdate()
              .executeTakeFirst();
            // The rating the match gained them; 0 when it gained nothing or was
            // unrated (no history row).
            const history = await trx
              .selectFrom("rating_history")
              .select(
                sql<number>`greatest(0, rating_after - rating_before)`.as(
                  "gain",
                ),
              )
              .where("match_id", "=", flag.match_id)
              .where("user_id", "=", flag.user_id)
              .executeTakeFirst();
            penalty = held === undefined ? 0 : (history?.gain ?? 0);
            // shortcut: no rating_history row for the penalty (it's keyed by match), so
            // the history jumps at the next match and a closed season's standing keeps
            // the gain; add a kind column if a history view ever shows the chain.
            if (penalty > 0)
              await trx
                .updateTable("player_rating")
                .set({
                  rating: sql<number>`rating - ${penalty}`,
                  updated_at: sql<Date>`now()`,
                })
                .where("user_id", "=", flag.user_id)
                .execute();
            // Nobody plays against the run again.
            await trx
              .deleteFrom("ghost_run")
              .where("match_id", "=", flag.match_id)
              .where("user_id", "=", flag.user_id)
              .execute();
          }
        }
        await trx
          .updateTable("fair_play_flag")
          .set({
            decision: decision === "penalize" ? "penalized" : "dismissed",
            decided_at: sql<Date>`now()`,
            decided_by: adminUserId,
            penalty,
          })
          .where("id", "=", flagId)
          .execute();
        return { userId: flag.user_id };
      }),
  };
}

// P5-W32-S01a (owner, 2026-11-13): a battle's penalty, as a quick match's: the battle
// rating that match gained, in its league; 0 when it gained nothing or was unrated.
// Battles leave no ghost runs.
async function penalizeBattle(
  trx: Kysely<DB>,
  flag: { match_id: string; user_id: string },
  league: string,
): Promise<number> {
  // Locked like rating a battle, so a battle rated meanwhile can't be lost.
  const held = await trx
    .selectFrom("battle_rating")
    .select("user_id")
    .where("user_id", "=", flag.user_id)
    .where("league", "=", league)
    .forUpdate()
    .executeTakeFirst();
  if (held === undefined) return 0;
  const history = await trx
    .selectFrom("battle_rating_history")
    .select(sql<number>`greatest(0, rating_after - rating_before)`.as("gain"))
    .where("match_id", "=", flag.match_id)
    .where("user_id", "=", flag.user_id)
    .executeTakeFirst();
  const penalty = history?.gain ?? 0;
  if (penalty > 0)
    await trx
      .updateTable("battle_rating")
      .set({
        rating: sql<number>`rating - ${penalty}`,
        updated_at: sql<Date>`now()`,
      })
      .where("user_id", "=", flag.user_id)
      .where("league", "=", league)
      .execute();
  return penalty;
}
