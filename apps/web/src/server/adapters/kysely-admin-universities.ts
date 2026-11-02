import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { AdminUniversities } from "../ports";

// P3-W14-S03 (ADR-0032): the owner tidies typed universities; listed ones are the seed's.
export function kyselyAdminUniversities(db: Kysely<DB>): AdminUniversities {
  // Kysely can't nest transactions: inside one (as the tests run), use it.
  const inTransaction = <T>(body: (trx: Kysely<DB>) => Promise<T>) =>
    db.isTransaction ? body(db) : db.transaction().execute(body);

  return {
    typed: async () => {
      const rows = await db
        .selectFrom("university as u")
        .leftJoin("player_university as p", "p.university_id", "u.id")
        .select(["u.id", "u.name", sql<string>`count(p.user_id)`.as("members")])
        .where("u.listed", "=", false)
        .groupBy(["u.id", "u.name"])
        .orderBy("members", "desc")
        .orderBy("u.name")
        .execute();
      return rows.map((r) => ({ ...r, members: Number(r.members) }));
    },

    rename: (id, name) =>
      inTransaction(async (trx) => {
        const row = await trx
          .selectFrom("university")
          .select("id")
          .where("id", "=", id)
          .where("listed", "=", false)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) return "missing";
        // Checked first, so university_typed_key doesn't fail the statement; a listed
        // name too, so boards never show two alike (merge into it instead).
        const taken = await trx
          .selectFrom("university")
          .select("id")
          .where("id", "<>", id)
          .where(sql<boolean>`lower(name) = lower(${name})`)
          .executeTakeFirst();
        if (taken !== undefined) return "taken";
        await trx
          .updateTable("university")
          .set({ name })
          .where("id", "=", id)
          .execute();
        return "renamed";
      }),

    merge: (id, intoId) =>
      inTransaction(async (trx) => {
        if (id === intoId) return null;
        const into = await trx
          .selectFrom("university")
          .select("id")
          .where("id", "=", intoId)
          // Held until commit: a merge or remove of it at once would clear the
          // players moved onto it.
          .forKeyShare()
          .executeTakeFirst();
        if (into === undefined) return null;
        const moved = await trx
          .selectFrom("university")
          .select("id")
          .where("id", "=", id)
          .where("listed", "=", false)
          .forUpdate()
          .executeTakeFirst();
        if (moved === undefined) return null;
        const players = await trx
          .updateTable("player_university")
          .set({ university_id: intoId })
          .where("university_id", "=", id)
          .returning("user_id")
          .execute();
        await trx.deleteFrom("university").where("id", "=", id).execute();
        return players.map((p) => p.user_id);
      }),

    remove: (id) =>
      inTransaction(async (trx) => {
        const row = await trx
          .selectFrom("university")
          .select("id")
          .where("id", "=", id)
          .where("listed", "=", false)
          .forUpdate()
          .executeTakeFirst();
        if (row === undefined) return null;
        const players = await trx
          .selectFrom("player_university")
          .select("user_id")
          .where("university_id", "=", id)
          .execute();
        await trx.deleteFrom("university").where("id", "=", id).execute();
        return players.map((p) => p.user_id);
      }),
  };
}
