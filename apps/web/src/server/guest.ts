import { log } from "./log";
import type { Actor, GuestLimits, GuestSessions } from "./ports";

export type GuestStart =
  | { ok: true; setCookies: string[]; actor: Actor }
  | { ok: false; message: string };

// ADR-0029: guests are for Play only (app/play/actions.ts), at most 10 a day from one
// network (P3-W13-S07), checked first. ADR-0056: no invite code and no beta group, so
// that limit and the one-player-per-browser rule (the caller's) are the only throttles.
// Only a guest that started counts.
export async function startGuest(
  deps: { guests: GuestSessions; limits: GuestLimits },
  headers: Headers,
  ip: string,
): Promise<GuestStart> {
  if (!(await deps.limits.allow(ip)))
    return {
      ok: false,
      message:
        "Too many guests from this network today. Sign in, or try again tomorrow.",
    };
  const started = await deps.guests.start(headers);
  // The guest exists: an uncounted start costs only a little of the limit, while
  // failing here would strand a guest no browser holds.
  try {
    await deps.limits.record(ip);
  } catch (error) {
    log.error("guest: start not counted toward the network's limit", { error });
  }
  return { ok: true, ...started };
}
