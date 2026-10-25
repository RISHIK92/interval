import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";
import { env } from "./env";
import { events, sessionReader } from "./server/container";
import { log } from "./server/log";
import {
  formatVisit,
  parseVisit,
  VISIT_COOKIE,
  VISIT_IDLE_SECONDS,
  visitCookieOptions,
} from "./server/visits";

// Re-setting the cookie on every request is wasted work. Refreshing at most once a minute
// means a visit can end up to a minute before 30 real idle minutes; fine for a weekly
// return metric.
const REFRESH_SECONDS = 60;

// Tracks visits for session_started (Q-P1-21). One session lookup per visit, not per
// request; a visitor without a session gets no visit. Join and sign-in start their own
// visit (app/visit.ts), so this covers returning users with a live session.
export async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
): Promise<NextResponse> {
  const response = NextResponse.next();
  const now = Math.floor(Date.now() / 1000);
  const visit = parseVisit(request.cookies.get(VISIT_COOKIE)?.value);
  const options = visitCookieOptions(env().BETTER_AUTH_URL);

  if (visit !== null && now - visit.lastSeen < VISIT_IDLE_SECONDS) {
    if (now - visit.lastSeen >= REFRESH_SECONDS) {
      response.cookies.set(
        VISIT_COOKIE,
        formatVisit({ id: visit.id, lastSeen: now }),
        options,
      );
    }
    return response;
  }

  // Analytics must never break a page: if the session can't be read, serve it anyway.
  let actor;
  try {
    actor = await sessionReader().current(request.headers);
  } catch (error) {
    log.error("visits: session lookup failed", { error });
    return response;
  }
  if (actor === null) return response;
  const id = crypto.randomUUID();
  response.cookies.set(
    VISIT_COOKIE,
    formatVisit({ id, lastSeen: now }),
    options,
  );
  const emitter = events();
  emitter.emit("session_started", {}, { ...actor, sessionId: id });
  // The proxy may finish before the emitter's timer; keep it alive until delivered.
  event.waitUntil(emitter.flush());
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes, Next internals and static files are not visits, and
      // neither is a background prefetch.
      source: "/((?!api/|_next/|favicon.ico|.*\\.[a-z0-9]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
