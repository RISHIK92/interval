import { cookies } from "next/headers";
import { READING_COOKIE } from "../server/reading";
import { env } from "../env";
import { events } from "../server/container";
import type { Actor } from "../server/ports";
import {
  formatVisit,
  VISIT_COOKIE,
  visitCookieOptions,
} from "../server/visits";

// Join and sign-in start the visit themselves. Their redirect renders the next page
// through an internal request whose Set-Cookie never reaches the browser, so a visit the
// proxy started there would be counted again on the next navigation. A cookie set here
// is both sent to the browser and seen by that internal render.
export async function startVisit(actor: Actor): Promise<void> {
  const id = crypto.randomUUID();
  const lastSeen = Math.floor(Date.now() / 1000);
  (await cookies()).set(
    VISIT_COOKIE,
    formatVisit({ id, lastSeen }),
    visitCookieOptions(env().BETTER_AUTH_URL),
  );
  events().emit("session_started", {}, { ...actor, sessionId: id });
}

// After sign-out the browser may be used by someone else; their visit starts fresh.
export async function endVisit(): Promise<void> {
  const jar = await cookies();
  jar.delete(VISIT_COOKIE);
  // What they were reading isn't the next person's (P1-W5-S02).
  jar.delete(READING_COOKIE);
}
