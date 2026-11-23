import type { DB } from "@interval/db";
import { type Kysely, type Selectable, sql } from "kysely";
import type { HldTournament, HldTournaments, BattleMode } from "../ports";

// P6-W43 (§6.4, HLDQ-3, Q-P6-07): HLD tournaments in Postgres. Starting a round is one
// conditional update (the round moves on from the one before), so two admins pressing
// "next round" can't both start it.
const CHECK_IN = "1 hour"; // Q-P6-07: check-in opens an hour before the start

// Inside a caller's transaction (a test's rollback), run there; otherwise in a new one.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

const toTournament = (r: Selectable<DB["hld_tournament"]>): HldTournament => ({
  id: r.id,
  name: r.name,
  battleMode: r.battle_mode as BattleMode, // the column's check allows only these
  startsAt: r.starts_at,
  round: r.round,
  finishedAt: r.finished_at,
});

export function kyselyHldTournaments(db: Kysely<DB>): HldTournaments {
  return {
    create: (t, by) =>
      inTransaction(db, async (trx) => {
        const row = await trx
          .insertInto("hld_tournament")
          .values({
            name: t.name,
            battle_mode: t.battleMode,
            starts_at: t.startsAt,
            created_by: by,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("hld_tournament_round")
          .values(
            t.rounds.map((r, i) => ({
              tournament_id: row.id,
              round: i + 1,
              family: r.family,
              seed: r.seed,
            })),
          )
          .execute();
        // HLDQ-3: retired as soon as they're chosen, so no match draws them meanwhile.
        await trx
          .insertInto("hld_retired_variant")
          .values(t.rounds.map((r) => ({ ...r, battle_mode: t.battleMode })))
          .onConflict((c) => c.doNothing())
          .execute();
        return row.id;
      }),

    list: async () =>
      (
        await db
          .selectFrom("hld_tournament")
          .selectAll()
          .orderBy("starts_at", "desc")
          .execute()
      ).map(toTournament),

    get: async (id) => {
      const row = await db
        .selectFrom("hld_tournament")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return row === undefined ? null : toTournament(row);
    },

    rounds: async (id) =>
      db
        .selectFrom("hld_tournament_round")
        .select(["round", "family", "seed"])
        .where("tournament_id", "=", id)
        .orderBy("round")
        .execute(),

    register: async (id, userId) => {
      const done = await sql`
        insert into hld_tournament_entry (tournament_id, user_id)
        select id, ${userId} from hld_tournament
        where id = ${id}::uuid and round = 0 and finished_at is null
        on conflict do nothing`.execute(db);
      return (done.numAffectedRows ?? 0n) > 0n;
    },

    unregister: async (id, userId) => {
      await sql`
        delete from hld_tournament_entry e using hld_tournament t
        where e.tournament_id = t.id and t.id = ${id}::uuid and t.round = 0
          and e.user_id = ${userId}`.execute(db);
    },

    checkIn: async (id, userId, now) => {
      const done = await sql`
        update hld_tournament_entry e
        set checked_in_at = ${now},
            university_id = (select university_id from player_university
              where user_id = ${userId})
        from hld_tournament t
        where e.tournament_id = t.id and t.id = ${id}::uuid and e.user_id = ${userId}
          and t.round = 0 and t.finished_at is null
          and ${now}::timestamptz >= t.starts_at - ${CHECK_IN}::interval`.execute(
        db,
      );
      if ((done.numAffectedRows ?? 0n) > 0n) return "checked_in";
      const entry = await db
        .selectFrom("hld_tournament_entry")
        .select("user_id")
        .where("tournament_id", "=", id)
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return entry === undefined ? "not_registered" : "not_open";
    },

    entries: async (id) => {
      const rows = await db
        .selectFrom("hld_tournament_entry as e")
        .innerJoin("app_user as u", "u.id", "e.user_id")
        .leftJoin("player_username as n", "n.user_id", "e.user_id")
        .leftJoin("university as uni", "uni.id", "e.university_id")
        .select([
          "e.user_id",
          sql<string>`coalesce(n.username, u.name)`.as("player"),
          "e.checked_in_at",
          "uni.name as university",
        ])
        .where("e.tournament_id", "=", id)
        .orderBy("e.registered_at")
        .orderBy("e.user_id") // registered in the same instant: a stable order
        .execute();
      return rows.map((r) => ({
        userId: r.user_id,
        player: r.player,
        checkedIn: r.checked_in_at !== null,
        university: r.university,
      }));
    },

    pairings: async (id) => {
      const rows = await db
        .selectFrom("hld_tournament_pairing")
        .select(["round", "slot", "player_a", "player_b", "match_id"])
        .where("tournament_id", "=", id)
        .orderBy("round")
        .orderBy("slot")
        .execute();
      return rows.map((r) => ({
        round: r.round,
        slot: r.slot,
        playerA: r.player_a,
        playerB: r.player_b,
        matchId: r.match_id,
      }));
    },

    claimRound: (id, from, to, pairings) =>
      inTransaction(db, async (trx) => {
        const moved = await trx
          .updateTable("hld_tournament")
          .set({ round: to })
          .where("id", "=", id)
          .where("round", "=", from)
          .where("finished_at", "is", null)
          .executeTakeFirst();
        if (moved.numUpdatedRows === 0n) return false;
        await trx
          .updateTable("hld_tournament_round")
          .set({ started_at: sql<Date>`now()` })
          .where("tournament_id", "=", id)
          .where("round", "=", to)
          .execute();
        if (pairings.length > 0)
          await trx
            .insertInto("hld_tournament_pairing")
            .values(
              pairings.map((p) => ({
                tournament_id: id,
                round: to,
                slot: p.slot,
                player_a: p.playerA,
                player_b: p.playerB,
                match_id: null,
              })),
            )
            .execute();
        return true;
      }),

    setMatch: async (id, round, slot, matchId) => {
      const done = await db
        .updateTable("hld_tournament_pairing")
        .set({ match_id: matchId })
        .where("tournament_id", "=", id)
        .where("round", "=", round)
        .where("slot", "=", slot)
        .where("player_b", "is not", null)
        .where("match_id", "is", null)
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },

    roundOf: async (matchId) => {
      const mine = await db
        .selectFrom("hld_tournament_pairing")
        .select(["tournament_id", "round"])
        .where("match_id", "=", matchId)
        .executeTakeFirst();
      if (mine === undefined) return null;
      const rows = await db
        .selectFrom("hld_tournament_pairing as p")
        .leftJoin("hld_match as m", "m.id", "p.match_id")
        .select(["p.player_a", "p.player_b", "p.match_id", "m.closed_at"])
        .where("p.tournament_id", "=", mine.tournament_id)
        .where("p.round", "=", mine.round)
        .execute();
      return {
        players: rows.flatMap((r) =>
          r.player_b === null ? [r.player_a] : [r.player_a, r.player_b],
        ),
        // A round is over once every one of its matches is (byes have none).
        over: rows.every((r) => r.match_id === null || r.closed_at !== null),
      };
    },

    finish: async (id, at) => {
      const done = await db
        .updateTable("hld_tournament")
        .set({ finished_at: at })
        .where("id", "=", id)
        .where("finished_at", "is", null)
        .executeTakeFirst();
      return done.numUpdatedRows > 0n;
    },
  };
}
