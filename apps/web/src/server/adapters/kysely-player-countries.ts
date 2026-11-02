import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { PlayerCountries } from "../ports";

// P3-W14-S02 (Q-P3-08; owner, 2026-11-02): a set or change at most once in 30 days;
// removing keeps the clock, so remove-then-set can't dodge it.
const MONTH = sql.raw(`interval '30 days'`);
const MONTH_MS = 30 * 86_400_000;

// Kysely can't nest transactions: inside one (as the tests run), use it.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

export function kyselyPlayerCountries(db: Kysely<DB>): PlayerCountries {
  // The row as it is, locked when asked, with when a change next opens (null: now).
  const current = async (
    trx: Kysely<DB>,
    userId: string,
    lock: boolean,
  ): Promise<{ country: string | null; opens: Date | null } | undefined> => {
    const { rows } = await sql<{ country: string | null; opens: Date | null }>`
      select country,
             case when changed_at + ${MONTH} > now() then changed_at + ${MONTH} end
               as opens
      from player_country where user_id = ${userId}
      ${lock ? sql`for update` : sql``}
    `.execute(trx);
    return rows[0];
  };

  return {
    get: async (userId) => {
      const row = await current(db, userId, false);
      return {
        country: row?.country ?? null,
        changeableFrom: row?.opens ?? null,
      };
    },

    // Locked, so a double submit or a remove at the same moment sees this one's
    // outcome, and `previous` is the country the row really had.
    set: (userId, country) =>
      inTransaction(db, async (trx) => {
        const row = await current(trx, userId, true);
        // The country it already has: no change, and the clock runs on.
        if (row?.country === country) return { ok: true, previous: country };
        if (row?.opens != null) return { ok: false, changeableFrom: row.opens };
        // A first set by two requests at once: the second waits on the key, then
        // finds the row and is a change inside the month, so it is refused.
        const written = await sql`
          insert into player_country (user_id, country, changed_at)
          values (${userId}, ${country}, now())
          on conflict (user_id) do update
            set country = excluded.country, changed_at = now()
            where player_country.changed_at + ${MONTH} <= now()
        `.execute(trx);
        if (written.numAffectedRows === 0n) {
          const now = await current(trx, userId, true);
          return { ok: false, changeableFrom: now?.opens ?? new Date() };
        }
        return { ok: true, previous: row?.country ?? null };
      }),

    remove: (userId) =>
      inTransaction(db, async (trx) => {
        const row = await current(trx, userId, true);
        if (row === undefined) return null;
        await trx
          .updateTable("player_country")
          .set({ country: null })
          .where("user_id", "=", userId)
          .execute();
        return row.country;
      }),
  };
}

// The in-memory fake (ADR-0012), on a given clock.
export function memoryPlayerCountries(
  now: () => number = Date.now,
): PlayerCountries {
  const rows = new Map<string, { country: string | null; changedAt: number }>();
  const opensAt = (userId: string): Date | null => {
    const row = rows.get(userId);
    return row === undefined || row.changedAt + MONTH_MS <= now()
      ? null
      : new Date(row.changedAt + MONTH_MS);
  };
  return {
    get: (userId) =>
      Promise.resolve({
        country: rows.get(userId)?.country ?? null,
        changeableFrom: opensAt(userId),
      }),
    set: (userId, country) => {
      const previous = rows.get(userId)?.country ?? null;
      if (previous === country) return Promise.resolve({ ok: true, previous });
      const opens = opensAt(userId);
      if (opens !== null)
        return Promise.resolve({ ok: false, changeableFrom: opens });
      rows.set(userId, { country, changedAt: now() });
      return Promise.resolve({ ok: true, previous });
    },
    remove: (userId) => {
      const row = rows.get(userId);
      const previous = row?.country ?? null;
      if (row !== undefined) row.country = null;
      return Promise.resolve(previous);
    },
  };
}
