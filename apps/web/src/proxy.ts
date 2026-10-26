import {
  type NextFetchEvent,
  type NextRequest,
  NextResponse,
} from "next/server";
import { env } from "./env";
import { CHIP_COOKIE, parseChip } from "./server/chips";
import { events, sessionReader } from "./server/container";
import { log } from "./server/log";
import { formatReading, parseReading, READING_COOKIE } from "./server/reading";
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

  // A chip link (Q-P1-16) is remembered for the browser session: no maxAge.
  const chip = parseChip(request.nextUrl.searchParams.get("chip"));
  if (chip !== null) {
    response.cookies.set(CHIP_COOKIE, chip, { ...options, maxAge: undefined });
  }

  // An in-app reader open feeds Now reading like a browser open through /out (ADR-0018,
  // owner 2026-10-26). Pages can't set cookies, so it's done here.
  // shortcut: a moment whose link fell back to the article is still remembered as the
  // moment; move this into /read if that fallback turns out to matter.
  // Only the shapes /read accepts: a chip and either a card position or a `from`.
  // shortcut: a signed-out request is still remembered (no session lookup on this path);
  // harmless, since Home asks for a session before showing it.
  const query = request.nextUrl.searchParams;
  const read = /^\/read\/([^/]+)$/.exec(request.nextUrl.pathname);
  const reading =
    read === null || chip === null || query.has("pos") === query.has("from")
      ? null
      : parseReading(`${read[1] ?? ""}.${query.get("moment") ?? ""}`);
  if (reading !== null) {
    response.cookies.set(READING_COOKIE, formatReading(reading), {
      ...options,
      maxAge: undefined,
    });
  }

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
