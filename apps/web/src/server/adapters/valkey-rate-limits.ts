import type { Redis } from "ioredis";
import type { RateLimits } from "../ports";

// A fixed window per key: the first call starts it (EXPIRE NX), the rest count.
export function valkeyRateLimits(redis: Redis, prefix = "limit:"): RateLimits {
  return {
    allow: async (key, limit, windowSeconds) => {
      const k = `${prefix}${key}`;
      const replies = await redis
        .multi()
        .incr(k)
        .expire(k, windowSeconds, "NX")
        .exec();
      const failed = replies?.find(([error]) => error !== null)?.[0];
      if (failed != null) throw failed;
      return Number(replies?.[0]?.[1]) <= limit;
    },
  };
}

// The in-memory fake (ADR-0012), on a given clock.
export function memoryRateLimits(now: () => number = Date.now): RateLimits {
  const windows = new Map<string, { count: number; until: number }>();
  return {
    allow: (key, limit, windowSeconds) => {
      const found = windows.get(key);
      const live =
        found !== undefined && found.until > now()
          ? found
          : { count: 0, until: now() + windowSeconds * 1000 };
      live.count += 1;
      windows.set(key, live);
      return Promise.resolve(live.count <= limit);
    },
  };
}
