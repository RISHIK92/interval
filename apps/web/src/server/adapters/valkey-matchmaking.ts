import type { Redis } from "ioredis";
import { log } from "../log";
import type { Matchmaking, QueueState } from "../ports";

// P3-W16-S02 (MATCH-3, Q-P3-14; owner, 2026-11-03): one region for now, carried in the
// keys. A player's band starts at ±100 and widens by 100 every 2 s; a pair needs each
// within the other's band. Pairing runs as players poll (about once a second).
//
// Each player is queued, then pending (paired, the match being made), then matched.
// Selecting and claiming a pair is one Lua script, so two pollers can't share an
// opponent and nobody is seen half-paired. (Per-player keys are named inside the
// scripts: fine on a single Valkey, which is what both modes run.)
const REGION = "main";
const BAND = 100;
const WIDEN_BY = 100;
const WIDEN_EVERY_MS = 2_000;
// Paired but never matched or put back (the request died mid-way): queued again.
const PENDING_MS = 10_000;
// Not polled for this long (a closed tab): dropped rather than matched.
const STALE_MS = 30_000;
const KEEP_SECONDS = 120; // a queued player's state, refreshed by each poll
const MATCHED_SECONDS = 60;

// Joining again while queued or pending changes nothing; after a match (played or not),
// it starts a fresh wait.
const JOIN = `
local key = KEYS[2] .. ARGV[1]
local state = redis.call('HGET', key, 'state')
if state == 'queued' or state == 'pending' then return 0 end
redis.call('DEL', key)
redis.call('HSET', key, 'state', 'queued', 'rating', ARGV[2], 'since', ARGV[3], 'seen', ARGV[3])
redis.call('EXPIRE', key, ARGV[4])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
return 1`;

const POLL = `
local q, pre, me = KEYS[1], KEYS[2], ARGV[1]
local now, base, by, every, stale, pendingFor = tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[8])
local mk = pre .. me
local s = redis.call('HMGET', mk, 'state', 'since', 'seen', 'rating', 'match', 'waited', 'told', 'paired')
if not s[1] then return {'none'} end
if s[1] == 'matched' then
  redis.call('HSET', mk, 'told', '1')
  return {'matched', s[5], s[6], s[7] and '0' or '1'}
end
local since = tonumber(s[2])
if s[1] == 'pending' then
  if now - tonumber(s[8]) <= pendingFor then return {'waiting', tostring(now - since)} end
  -- Paired, but never matched or put back: queued again.
  redis.call('HSET', mk, 'state', 'queued')
  redis.call('ZADD', q, s[4], me)
end
if now - tonumber(s[3]) > stale then
  redis.call('ZREM', q, me)
  redis.call('DEL', mk)
  return {'none'}
end
redis.call('HSET', mk, 'seen', now)
redis.call('EXPIRE', mk, ARGV[7])
local rating = tonumber(s[4])
local function band(waited) return base + by * math.floor(waited / every) end
local reach = band(now - since)
local found = redis.call('ZRANGEBYSCORE', q, rating - reach, rating + reach, 'WITHSCORES')
local best, gap, bestSince
for i = 1, #found, 2 do
  local other = found[i]
  if other ~= me then
    local ok = pre .. other
    local o = redis.call('HMGET', ok, 'since', 'seen', 'state')
    if not o[1] or o[3] ~= 'queued' then
      redis.call('ZREM', q, other)
    elseif now - tonumber(o[2]) > stale then
      redis.call('ZREM', q, other)
      redis.call('DEL', ok)
    else
      local g = math.abs(tonumber(found[i + 1]) - rating)
      if g <= band(now - tonumber(o[1])) and (not best or g < gap) then
        best, gap, bestSince = other, g, tonumber(o[1])
      end
    end
  end
end
if not best then return {'waiting', tostring(now - since)} end
redis.call('ZREM', q, me, best)
redis.call('HSET', mk, 'state', 'pending', 'paired', now)
redis.call('HSET', pre .. best, 'state', 'pending', 'paired', now)
return {'paired', best, tostring(now - since), tostring(now - bestSince)}`;

// The match is made: both matched, unless one left (or isn't pending any more: it
// expired or was queued again); then whoever is still pending queues again with its
// wait, and the match, never started, is cancelled by its server.
const DONE = `
local q, pre = KEYS[1], KEYS[2]
local seats = {{pre .. ARGV[1], ARGV[1]}, {pre .. ARGV[2], ARGV[2]}}
local both = true
for _, seat in ipairs(seats) do
  local s = redis.call('HMGET', seat[1], 'state', 'left')
  if s[1] ~= 'pending' or s[2] == '1' then both = false end
end
if not both then
  for _, seat in ipairs(seats) do
    local s = redis.call('HMGET', seat[1], 'state', 'left', 'rating')
    if s[1] == 'pending' then
      if s[2] == '1' then
        redis.call('DEL', seat[1])
      else
        redis.call('HSET', seat[1], 'state', 'queued', 'seen', ARGV[6])
        redis.call('ZADD', q, s[3], seat[2])
      end
    end
  end
  return 0
end
redis.call('HSET', seats[1][1], 'state', 'matched', 'match', ARGV[3], 'waited', ARGV[4], 'told', '1')
redis.call('HSET', seats[2][1], 'state', 'matched', 'match', ARGV[3], 'waited', ARGV[5])
redis.call('EXPIRE', seats[1][1], ARGV[7])
redis.call('EXPIRE', seats[2][1], ARGV[7])
return 1`;

// The match couldn't be made: both queue again with their waits (one who left goes).
const FAILED = `
local q, pre = KEYS[1], KEYS[2]
for i = 1, 2 do
  local key = pre .. ARGV[i]
  local s = redis.call('HMGET', key, 'state', 'left', 'rating')
  if s[1] == 'pending' then
    if s[2] == '1' then
      redis.call('DEL', key)
    else
      redis.call('HSET', key, 'state', 'queued', 'seen', ARGV[3])
      redis.call('ZADD', q, s[3], ARGV[i])
    end
  end
end
return 1`;

const LEAVE = `
local key = KEYS[2] .. ARGV[1]
local state = redis.call('HGET', key, 'state')
if state == 'queued' then
  redis.call('ZREM', KEYS[1], ARGV[1])
  redis.call('DEL', key)
elseif state == 'pending' then
  redis.call('HSET', key, 'left', '1')
end
return 1`;

export function valkeyMatchmaking(
  redis: Redis,
  start: (players: string[]) => Promise<string>,
  now: () => number = Date.now,
  prefix = `mm:${REGION}:`,
): Matchmaking {
  const keys = [`${prefix}queue`, `${prefix}p:`] as const;
  const run = (script: string, ...args: (string | number)[]) =>
    redis.eval(script, 2, ...keys, ...args.map(String));
  return {
    join: async (userId, rating) => {
      await run(JOIN, userId, rating, now(), KEEP_SECONDS);
    },

    poll: async (userId): Promise<QueueState> => {
      const at = now();
      const reply = (await run(
        POLL,
        userId,
        at,
        BAND,
        WIDEN_BY,
        WIDEN_EVERY_MS,
        STALE_MS,
        KEEP_SECONDS,
        PENDING_MS,
      )) as string[];
      const [kind, ...rest] = reply;
      if (kind === "none") return { status: "none" };
      if (kind === "waiting")
        return { status: "waiting", waitedMs: Number(rest[0]) };
      if (kind === "matched")
        return {
          status: "matched",
          matchId: rest[0] ?? "",
          waitedMs: Number(rest[1]),
          first: rest[2] === "1",
        };
      const [opponent = "", mine = "0", theirs = "0"] = rest;
      let matchId: string;
      try {
        matchId = await start([userId, opponent]);
      } catch (error) {
        // LOAD-5: both wait on from when they joined, and pair again; counted.
        log.error("game: match not made", { error });
        await run(FAILED, userId, opponent, now());
        return { status: "waiting", waitedMs: Number(mine) };
      }
      // A failure here leaves both pending; their next polls queue them again.
      const made = await run(
        DONE,
        userId,
        opponent,
        matchId,
        mine,
        theirs,
        now(),
        MATCHED_SECONDS,
      );
      return made === 1
        ? { status: "matched", matchId, waitedMs: Number(mine), first: true }
        : { status: "waiting", waitedMs: Number(mine) };
    },

    leave: async (userId) => {
      await run(LEAVE, userId);
    },
  };
}

type Seat = {
  state: "queued" | "pending" | "matched";
  rating: number;
  since: number;
  seen: number;
  paired?: number;
  left?: boolean;
  expires: number;
  match?: { id: string; waitedMs: number; told: boolean };
};

// The in-memory fake (ADR-0012): the same states, rules and expiries, over a map.
export function memoryMatchmaking(
  start: (players: string[]) => Promise<string>,
  now: () => number = Date.now,
): Matchmaking {
  const seats = new Map<string, Seat>();
  const band = (waited: number) =>
    BAND + WIDEN_BY * Math.floor(waited / WIDEN_EVERY_MS);
  const live = (userId: string): Seat | undefined => {
    const seat = seats.get(userId);
    if (seat !== undefined && seat.expires <= now()) {
      seats.delete(userId);
      return undefined;
    }
    return seat;
  };
  const requeue = (pairs: [string, Seat][]) => {
    for (const [id, seat] of pairs) {
      if (seat.state !== "pending" || live(id) !== seat) continue;
      if (seat.left === true) seats.delete(id);
      else Object.assign(seat, { state: "queued", seen: now() });
    }
  };
  return {
    join: (userId, rating) => {
      const seat = live(userId);
      if (seat?.state !== "queued" && seat?.state !== "pending") {
        const at = now();
        seats.set(userId, {
          state: "queued",
          rating,
          since: at,
          seen: at,
          expires: at + KEEP_SECONDS * 1000,
        });
      }
      return Promise.resolve();
    },

    poll: async (userId) => {
      const me = live(userId);
      const at = now();
      if (me === undefined) return { status: "none" };
      if (me.state === "matched" && me.match !== undefined) {
        const first = !me.match.told;
        me.match.told = true;
        return {
          status: "matched",
          matchId: me.match.id,
          waitedMs: me.match.waitedMs,
          first,
        };
      }
      const waited = at - me.since;
      if (me.state === "pending") {
        if (at - (me.paired ?? at) <= PENDING_MS)
          return { status: "waiting", waitedMs: waited };
        me.state = "queued";
      }
      if (at - me.seen > STALE_MS) {
        seats.delete(userId);
        return { status: "none" };
      }
      me.seen = at;
      me.expires = at + KEEP_SECONDS * 1000;
      let best: [string, Seat] | undefined;
      // In rating order, then id: Valkey's ZRANGEBYSCORE order, so ties break alike.
      const queued = [...seats]
        .filter(([, them]) => them.state === "queued")
        .sort(([x, a], [y, b]) => a.rating - b.rating || (x < y ? -1 : 1));
      for (const [other, them] of queued) {
        if (other === userId || live(other) === undefined) continue;
        if (at - them.seen > STALE_MS) {
          seats.delete(other);
          continue;
        }
        const gap = Math.abs(them.rating - me.rating);
        if (gap > band(waited) || gap > band(at - them.since)) continue;
        if (best === undefined || gap < Math.abs(best[1].rating - me.rating))
          best = [other, them];
      }
      if (best === undefined) return { status: "waiting", waitedMs: waited };
      const [opponent, them] = best;
      Object.assign(me, { state: "pending", paired: at });
      Object.assign(them, { state: "pending", paired: at });
      const theirs = at - them.since;
      let matchId: string;
      try {
        matchId = await start([userId, opponent]);
      } catch (error) {
        log.error("game: match not made", { error });
        requeue([
          [userId, me],
          [opponent, them],
        ]);
        return { status: "waiting", waitedMs: waited };
      }
      const pending = (id: string, seat: Seat) =>
        live(id) === seat && seat.state === "pending" && seat.left !== true;
      if (!pending(userId, me) || !pending(opponent, them)) {
        requeue([
          [userId, me],
          [opponent, them],
        ]);
        return { status: "waiting", waitedMs: waited };
      }
      const until = now() + MATCHED_SECONDS * 1000;
      Object.assign(me, {
        state: "matched",
        expires: until,
        match: { id: matchId, waitedMs: waited, told: true },
      });
      Object.assign(them, {
        state: "matched",
        expires: until,
        match: { id: matchId, waitedMs: theirs, told: false },
      });
      return { status: "matched", matchId, waitedMs: waited, first: true };
    },

    leave: (userId) => {
      const seat = live(userId);
      if (seat?.state === "queued") seats.delete(userId);
      else if (seat?.state === "pending") seat.left = true;
      return Promise.resolve();
    },
  };
}
