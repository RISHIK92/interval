import type { Redis } from "ioredis";
import { z } from "zod";
import type { PracticeSession, PracticeSessions } from "../ports";

// ADR-0048 (Q-WD-28): a player's open LLD practice session, for as long as the game
// server keeps one (an hour), so a reload goes back to it.
const SECONDS = 3600;
// Written only here; anything else, JSON or not, is no session, and the next start
// replaces it.
const Stored = z
  .string()
  .transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "not JSON" });
      return z.NEVER;
    }
  })
  .pipe(z.object({ slug: z.string(), matchId: z.string() }));

export function valkeyPracticeSessions(
  redis: Redis,
  prefix = "lld:practice:",
): PracticeSessions {
  return {
    get: async (userId) => {
      const raw = await redis.get(`${prefix}${userId}`);
      if (raw === null) return null;
      const parsed = Stored.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    set: async (userId, session) => {
      await redis.set(
        `${prefix}${userId}`,
        JSON.stringify(session),
        "EX",
        SECONDS,
      );
    },
  };
}

// The in-memory fake (ADR-0012); sessions never lapse.
export function memoryPracticeSessions(): PracticeSessions {
  const open = new Map<string, PracticeSession>();
  return {
    get: (userId) => Promise.resolve(open.get(userId) ?? null),
    set: (userId, session) => {
      open.set(userId, session);
      return Promise.resolve();
    },
  };
}
