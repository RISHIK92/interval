import type { Redis } from "ioredis";
import type { SoloLocks } from "../ports";

// A claim made before its match exists; a bound claim holds the match's id.
const PENDING = "pending";
// Delete only while the key still holds the given match: a newer claim stays.
const RELEASE =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

export function valkeySoloLocks(redis: Redis, prefix = ""): SoloLocks {
  const key = (userId: string, game: string) =>
    `${prefix}${game}:solo:${userId}`;
  return {
    claim: async (userId, game, seconds) => {
      const k = key(userId, game);
      if ((await redis.set(k, PENDING, "EX", seconds, "NX")) === "OK")
        return true;
      const held = await redis.get(k);
      // Claims from before matches were bound ("1") are pending too.
      return {
        matchId:
          held === null || held === PENDING || held === "1" ? null : held,
      };
    },
    bind: async (userId, game, matchId) => {
      await redis.call("SET", key(userId, game), matchId, "XX", "KEEPTTL");
    },
    release: async (userId, game, matchId) => {
      await redis.eval(RELEASE, 1, key(userId, game), matchId);
    },
  };
}

// The in-memory fake (ADR-0012), on a given clock.
export function memorySoloLocks(now: () => number = Date.now): SoloLocks {
  const held = new Map<string, { matchId: string | null; until: number }>();
  const live = (k: string) => {
    const found = held.get(k);
    return found !== undefined && found.until > now() ? found : undefined;
  };
  return {
    claim: (userId, game, seconds) => {
      const k = `${game}:${userId}`;
      const found = live(k);
      if (found !== undefined)
        return Promise.resolve({ matchId: found.matchId });
      held.set(k, { matchId: null, until: now() + seconds * 1000 });
      return Promise.resolve(true);
    },
    bind: (userId, game, matchId) => {
      const found = live(`${game}:${userId}`);
      if (found !== undefined) found.matchId = matchId;
      return Promise.resolve();
    },
    release: (userId, game, matchId) => {
      const k = `${game}:${userId}`;
      if (live(k)?.matchId === matchId) held.delete(k);
      return Promise.resolve();
    },
  };
}
