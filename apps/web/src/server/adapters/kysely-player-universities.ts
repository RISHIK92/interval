import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type {
  PlayerUniversities,
  University,
  UniversityChange,
} from "../ports";

// P3-W14-S03 (§6.7, ADR-0032; owner, 2026-11-02): a set or change at most once in 30
// days; removing keeps the clock, so remove-then-set can't dodge it.
const MONTH = sql.raw(`interval '30 days'`);
const MONTH_MS = 30 * 86_400_000;

// Kysely can't nest transactions: inside one (as the tests run), use it.
const inTransaction = <T>(
  db: Kysely<DB>,
  body: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> => (db.isTransaction ? body(db) : db.transaction().execute(body));

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, "\\$&");

export function kyselyPlayerUniversities(db: Kysely<DB>): PlayerUniversities {
  const columns = ["id", "name", "country", "listed"] as const;
  const byId = (trx: Kysely<DB>, id: string) =>
    trx
      .selectFrom("university")
      .select(columns)
      .where("id", "=", id)
      .executeTakeFirst();

  // The player's row as it is, locked when asked, with when a change next opens.
  const current = async (trx: Kysely<DB>, userId: string, lock: boolean) => {
    const { rows } = await sql<{
      university_id: string | null;
      opens: Date | null;
    }>`
      select university_id,
             case when changed_at + ${MONTH} > now() then changed_at + ${MONTH} end
               as opens
      from player_university where user_id = ${userId}
      ${lock ? sql`for update` : sql``}
    `.execute(trx);
    return rows[0];
  };

  // Locked, so a double submit or a remove at the same moment sees this one's outcome.
  // A first pick has no row to lock, so an open one (no university, its clock long
  // past) is made first: two first picks at once then queue on it. `pick` runs only
  // once the change is allowed, so a refusal makes no typed row.
  const change = (
    userId: string,
    pick: (trx: Kysely<DB>) => Promise<University | undefined>,
    same: (trx: Kysely<DB>) => Promise<University | undefined>,
  ): Promise<UniversityChange> =>
    inTransaction(db, async (trx) => {
      await sql`
        insert into player_university (user_id, university_id, changed_at)
        values (${userId}, null, '-infinity')
        on conflict (user_id) do nothing
      `.execute(trx);
      const row = await current(trx, userId, true);
      const previous =
        row?.university_id == null
          ? null
          : ((await byId(trx, row.university_id)) ?? null);
      const again = await same(trx);
      if (again !== undefined && again.id === previous?.id)
        return { ok: true, university: again, previous };
      if (row?.opens != null)
        return { ok: false, reason: "soon", changeableFrom: row.opens };
      const university = await pick(trx);
      if (university === undefined) return { ok: false, reason: "unknown" };
      await trx
        .updateTable("player_university")
        .set({ university_id: university.id, changed_at: sql`now()` })
        .where("user_id", "=", userId)
        .execute();
      return { ok: true, university, previous };
    });

  // The listed one when exactly one has the name (56 listed names are in more than one
  // country: those are picked by search), else the typed one.
  const named = (trx: Kysely<DB>, name: string) =>
    trx
      .selectFrom("university")
      .select(columns)
      .where(sql<boolean>`lower(name) = lower(${name})`)
      .where(
        sql<boolean>`(not listed or (select count(*) from university
          where listed and lower(name) = lower(${name})) = 1)`,
      )
      .orderBy("listed", "desc")
      .orderBy("id")
      .limit(1)
      .executeTakeFirst();

  return {
    get: async (userId) => {
      const { rows } = await sql<
        University & { opens: Date | null; has: boolean }
      >`
        select u.id, u.name, u.country, u.listed, u.id is not null as has,
               case when p.changed_at + ${MONTH} > now()
                 then p.changed_at + ${MONTH} end as opens
        from player_university p left join university u on u.id = p.university_id
        where p.user_id = ${userId}
      `.execute(db);
      const row = rows[0];
      return {
        university:
          row?.has === true
            ? {
                id: row.id,
                name: row.name,
                country: row.country,
                listed: row.listed,
              }
            : null,
        changeableFrom: row?.opens ?? null,
      };
    },

    search: async (query, limit) => {
      const text = escapeLike(query);
      return db
        .selectFrom("university")
        .select(columns)
        .where("name", "ilike", `%${text}%`)
        .orderBy(sql`name ilike ${`${text}%`}`, "desc")
        .orderBy(sql`length(name)`)
        .orderBy("name")
        .orderBy("id")
        .limit(limit)
        .execute();
    },

    set: (userId, universityId) =>
      change(
        userId,
        (trx) => byId(trx, universityId),
        (trx) => byId(trx, universityId),
      ),

    setTyped: (userId, name) =>
      change(
        userId,
        async (trx) => {
          const found = await named(trx, name);
          if (found !== undefined) return found;
          // Two players typing it at once: the second finds the first's row.
          await sql`
            insert into university (name, listed) values (${name}, false)
            on conflict (lower(name)) where not listed do nothing
          `.execute(trx);
          return named(trx, name);
        },
        (trx) => named(trx, name),
      ),

    names: async (ids) =>
      ids.length === 0
        ? []
        : db
            .selectFrom("university")
            .select(columns)
            .where("id", "in", ids)
            .execute(),

    remove: (userId) =>
      inTransaction(db, async (trx) => {
        const row = await current(trx, userId, true);
        if (row?.university_id == null) return null;
        await trx
          .updateTable("player_university")
          .set({ university_id: null })
          .where("user_id", "=", userId)
          .execute();
        return (await byId(trx, row.university_id)) ?? null;
      }),
  };
}

// The in-memory fake (ADR-0012), on a given clock, over the given listed universities.
export function memoryPlayerUniversities(
  listed: University[],
  now: () => number = Date.now,
): PlayerUniversities {
  const universities = [...listed];
  const players = new Map<
    string,
    { universityId: string | null; changedAt: number }
  >();
  const opensAt = (userId: string): Date | null => {
    const row = players.get(userId);
    return row === undefined || row.changedAt + MONTH_MS <= now()
      ? null
      : new Date(row.changedAt + MONTH_MS);
  };
  const byId = (id: string | null | undefined) =>
    universities.find((u) => u.id === id);
  const named = (name: string) => {
    const all = universities.filter(
      (u) => u.name.toLowerCase() === name.toLowerCase(),
    );
    const listed = all.filter((u) => u.listed);
    return listed.length === 1 ? listed[0] : all.find((u) => !u.listed);
  };
  const change = (
    userId: string,
    pick: () => University | undefined,
    same: University | undefined,
  ): Promise<UniversityChange> => {
    const previous = byId(players.get(userId)?.universityId) ?? null;
    if (same !== undefined && same.id === previous?.id)
      return Promise.resolve({ ok: true, university: same, previous });
    const opens = opensAt(userId);
    if (opens !== null)
      return Promise.resolve({
        ok: false,
        reason: "soon",
        changeableFrom: opens,
      });
    const university = pick();
    if (university === undefined)
      return Promise.resolve({ ok: false, reason: "unknown" });
    players.set(userId, { universityId: university.id, changedAt: now() });
    return Promise.resolve({ ok: true, university, previous });
  };
  return {
    get: (userId) =>
      Promise.resolve({
        university: byId(players.get(userId)?.universityId) ?? null,
        changeableFrom: opensAt(userId),
      }),
    search: (query, limit) => {
      const text = query.toLowerCase();
      return Promise.resolve(
        universities
          .filter((u) => u.name.toLowerCase().includes(text))
          .sort(
            (a, b) =>
              Number(b.name.toLowerCase().startsWith(text)) -
                Number(a.name.toLowerCase().startsWith(text)) ||
              a.name.length - b.name.length ||
              a.name.localeCompare(b.name),
          )
          .slice(0, limit),
      );
    },
    set: (userId, universityId) =>
      change(userId, () => byId(universityId), byId(universityId)),
    setTyped: (userId, name) =>
      change(
        userId,
        () => {
          const found = named(name);
          if (found !== undefined) return found;
          const made: University = {
            id: String(universities.length + 1000),
            name,
            country: null,
            listed: false,
          };
          universities.push(made);
          return made;
        },
        named(name),
      ),
    names: (ids) =>
      Promise.resolve(universities.filter((u) => ids.includes(u.id))),
    remove: (userId) => {
      const row = players.get(userId);
      const previous = byId(row?.universityId) ?? null;
      if (row !== undefined) row.universityId = null;
      return Promise.resolve(previous);
    },
  };
}
