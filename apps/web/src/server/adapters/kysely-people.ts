import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { Follows, Person, Usernames } from "../ports";

// P3-W14-S05 (§6.7, Q-P3-11; owner, 2026-11-02): usernames and one-way follows.

// Byte order, as JavaScript sorts: a locale collation would skip the underscore.
const BY_NAME = sql`username collate "C"`;
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, "\\$&");

export function kyselyUsernames(db: Kysely<DB>): Usernames {
  return {
    get: async (userId) =>
      (await db
        .selectFrom("player_username")
        .select(["username", "searchable"])
        .where("user_id", "=", userId)
        .executeTakeFirst()) ?? null,

    // One statement: a double submit or two players racing for a name can't both win.
    claim: async (userId, username) => {
      const { rows } = await sql<{ claimed: boolean }>`
        insert into player_username (user_id, username) values (${userId}, ${username})
        on conflict do nothing
        returning true as claimed
      `.execute(db);
      if (rows.length === 1) return "claimed";
      return (await db
        .selectFrom("player_username")
        .select("user_id")
        .where("user_id", "=", userId)
        .executeTakeFirst()) === undefined
        ? "taken"
        : "has-one";
    },

    setSearchable: async (userId, searchable) => {
      await db
        .updateTable("player_username")
        .set({ searchable })
        .where("user_id", "=", userId)
        .execute();
    },

    search: (prefix, limit) =>
      db
        .selectFrom("player_username")
        .select(["user_id as userId", "username"])
        .where("searchable", "=", true)
        .where("username", "like", `${escapeLike(prefix)}%`)
        .orderBy(BY_NAME)
        .limit(limit)
        .execute(),

    labels: async (userIds) =>
      userIds.length === 0
        ? []
        : db
            .selectFrom("app_user as p")
            .leftJoin("player_username as u", "u.user_id", "p.id")
            .select(["p.id as userId", "u.username", "p.is_anonymous as guest"])
            .where("p.id", "in", userIds)
            .execute(),

    byName: async (username) =>
      (
        await db
          .selectFrom("player_username")
          .select("user_id")
          .where("username", "=", username)
          .executeTakeFirst()
      )?.user_id ?? null,
  };
}

export function kyselyFollows(db: Kysely<DB>): Follows {
  const people = (side: "follower_id" | "followee_id", userId: string) => {
    const other = side === "follower_id" ? "followee_id" : "follower_id";
    return db
      .selectFrom("follow as f")
      .innerJoin("player_username as u", "u.user_id", `f.${other}`)
      .select(["u.user_id as userId", "u.username"])
      .where(`f.${side}`, "=", userId)
      .orderBy(sql`u.username collate "C"`)
      .execute();
  };
  return {
    follow: async (followerId, followeeId) => {
      if (followerId === followeeId) return false;
      const result = await db
        .insertInto("follow")
        .values({ follower_id: followerId, followee_id: followeeId })
        .onConflict((oc) => oc.doNothing())
        .executeTakeFirst();
      return result.numInsertedOrUpdatedRows === 1n;
    },
    unfollow: async (followerId, followeeId) =>
      (
        await db
          .deleteFrom("follow")
          .where("follower_id", "=", followerId)
          .where("followee_id", "=", followeeId)
          .executeTakeFirst()
      ).numDeletedRows === 1n,
    following: (userId) => people("follower_id", userId),
    followers: (userId) => people("followee_id", userId),
  };
}

// The in-memory fakes (ADR-0012), sharing the players' usernames, over the given
// accounts and guests (a player neither is unknown).
export function memoryPeople(
  accounts: Set<string> = new Set(),
  guests: Set<string> = new Set(),
): {
  usernames: Usernames;
  follows: Follows;
} {
  const names = new Map<string, { username: string; searchable: boolean }>();
  const edges = new Set<string>(); // "follower followee"
  const byName = (a: Person, b: Person) =>
    a.username < b.username ? -1 : a.username > b.username ? 1 : 0;
  const person = (userId: string): Person[] => {
    const row = names.get(userId);
    return row === undefined ? [] : [{ userId, username: row.username }];
  };
  const pairs = () => [...edges].map((e) => e.split(" ") as [string, string]);
  return {
    usernames: {
      get: (userId) => {
        const row = names.get(userId);
        return Promise.resolve(row === undefined ? null : { ...row });
      },
      claim: (userId, username) => {
        if (names.has(userId)) return Promise.resolve("has-one");
        if ([...names.values()].some((r) => r.username === username))
          return Promise.resolve("taken");
        names.set(userId, { username, searchable: true });
        return Promise.resolve("claimed");
      },
      setSearchable: (userId, searchable) => {
        const row = names.get(userId);
        if (row !== undefined) row.searchable = searchable;
        return Promise.resolve();
      },
      search: (prefix, limit) =>
        Promise.resolve(
          [...names]
            .filter(([, r]) => r.searchable && r.username.startsWith(prefix))
            .map(([userId, r]) => ({ userId, username: r.username }))
            .sort(byName)
            .slice(0, limit),
        ),
      labels: (userIds) =>
        Promise.resolve(
          userIds
            .filter((id) => accounts.has(id) || guests.has(id))
            .map((userId) => ({
              userId,
              username: names.get(userId)?.username ?? null,
              guest: guests.has(userId),
            })),
        ),
      byName: (username) =>
        Promise.resolve(
          [...names].find(([, r]) => r.username === username)?.[0] ?? null,
        ),
    },
    follows: {
      follow: (followerId, followeeId) => {
        const key = `${followerId} ${followeeId}`;
        if (followerId === followeeId || edges.has(key))
          return Promise.resolve(false);
        edges.add(key);
        return Promise.resolve(true);
      },
      unfollow: (followerId, followeeId) =>
        Promise.resolve(edges.delete(`${followerId} ${followeeId}`)),
      following: (userId) =>
        Promise.resolve(
          pairs()
            .filter(([from]) => from === userId)
            .flatMap(([, to]) => person(to))
            .sort(byName),
        ),
      followers: (userId) =>
        Promise.resolve(
          pairs()
            .filter(([, to]) => to === userId)
            .flatMap(([from]) => person(from))
            .sort(byName),
        ),
    },
  };
}
