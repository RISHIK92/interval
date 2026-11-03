import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  ACCEPTED_SECONDS,
  CHALLENGE_SECONDS,
  type ChallengeAccepted,
  type Challenges,
  type ChallengeState,
  GAME_MODES,
  type GameMode,
  ONLINE_SECONDS,
} from "../ports";

// P3-W17-S03 (Q-P3-16): challenge:<token> is {sender, mode, taken?}; presence:<user> is
// set by each heartbeat; challenge-for:<sender> holds the accepted match a minute.
const Mode = z.enum(GAME_MODES);
const Accepted = z.object({ matchId: z.string(), mode: Mode });

// One step, so two openers can't both take it.
const TAKE = `
local c = redis.call('HMGET', KEYS[1], 'sender', 'mode', 'taken')
if not c[1] then return {'expired'} end
if c[3] then return {'taken'} end
if c[1] == ARGV[1] then return {'own'} end
redis.call('HSET', KEYS[1], 'taken', ARGV[1])
return {'open', c[1], c[2]}`;

function state(reply: string[]): ChallengeState {
  const [status, sender = "", mode = ""] = reply;
  if (status === "open") return { status, sender, mode: Mode.parse(mode) };
  if (status === "taken" || status === "own") return { status };
  return { status: "expired" };
}

export function valkeyChallenges(redis: Redis, prefix = ""): Challenges {
  const challenge = (token: string) => `${prefix}challenge:${token}`;
  const presence = (userId: string) => `${prefix}presence:${userId}`;
  const accepted = (sender: string) => `${prefix}challenge-for:${sender}`;
  return {
    create: async (sender, mode: GameMode) => {
      const token = randomBytes(16).toString("base64url");
      // ioredis reports a command's own failure in its reply, not as a rejection.
      const replies = await redis
        .multi()
        .hset(challenge(token), "sender", sender, "mode", mode)
        .expire(challenge(token), CHALLENGE_SECONDS)
        .exec();
      const failed = replies?.find(([error]) => error !== null)?.[0];
      if (failed != null) throw failed;
      return token;
    },
    peek: async (token, opener) => {
      const [sender, mode, taken] = await redis.hmget(
        challenge(token),
        "sender",
        "mode",
        "taken",
      );
      if (sender == null || mode == null) return { status: "expired" };
      if (taken != null) return { status: "taken" };
      if (sender === opener) return { status: "own" };
      return { status: "open", sender, mode: Mode.parse(mode) };
    },
    take: async (token, opener) =>
      state((await redis.eval(TAKE, 1, challenge(token), opener)) as string[]),
    beat: async (userId) => {
      await redis.set(presence(userId), "1", "EX", ONLINE_SECONDS);
    },
    online: async (userId) => (await redis.exists(presence(userId))) === 1,
    notify: async (sender, match) => {
      await redis.set(
        accepted(sender),
        JSON.stringify(match),
        "EX",
        ACCEPTED_SECONDS,
      );
    },
    pending: async (sender) => {
      const raw = await redis.get(accepted(sender));
      if (raw === null) return null;
      const parsed = Accepted.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    },
  };
}

// The in-memory fake (ADR-0012): the same rules and expiries, on a given clock.
export function memoryChallenges(now: () => number = Date.now): Challenges {
  const links = new Map<
    string,
    { sender: string; mode: GameMode; until: number; taken?: string }
  >();
  const seen = new Map<string, number>();
  const notes = new Map<string, { note: ChallengeAccepted; until: number }>();
  const look = (token: string, opener: string): ChallengeState => {
    const c = links.get(token);
    if (c === undefined || c.until <= now()) return { status: "expired" };
    if (c.taken !== undefined) return { status: "taken" };
    if (c.sender === opener) return { status: "own" };
    return { status: "open", sender: c.sender, mode: c.mode };
  };
  let made = 0;
  return {
    create: (sender, mode) => {
      made += 1;
      const token = `t${String(made)}`;
      links.set(token, {
        sender,
        mode,
        until: now() + CHALLENGE_SECONDS * 1000,
      });
      return Promise.resolve(token);
    },
    peek: (token, opener) => Promise.resolve(look(token, opener)),
    take: (token, opener) => {
      const found = look(token, opener);
      const c = links.get(token);
      if (found.status === "open" && c !== undefined) c.taken = opener;
      return Promise.resolve(found);
    },
    beat: (userId) => {
      seen.set(userId, now() + ONLINE_SECONDS * 1000);
      return Promise.resolve();
    },
    online: (userId) => Promise.resolve((seen.get(userId) ?? 0) > now()),
    notify: (sender, note) => {
      notes.set(sender, { note, until: now() + ACCEPTED_SECONDS * 1000 });
      return Promise.resolve();
    },
    pending: (sender) => {
      const found = notes.get(sender);
      return Promise.resolve(
        found !== undefined && found.until > now() ? found.note : null,
      );
    },
  };
}
