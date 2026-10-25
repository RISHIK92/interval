// Visits (owner, 2026-10-25): session_started fires on the first request after 30
// minutes without activity (Q-P1-21's return metric). The cookie holds the visit id and
// the last activity in epoch seconds: `<visitId>.<lastSeen>`.
export const VISIT_COOKIE = "iv_visit";
export const VISIT_IDLE_SECONDS = 30 * 60;

type Visit = { id: string; lastSeen: number };

export function parseVisit(value: string | undefined): Visit | null {
  const match = /^([A-Za-z0-9-]{1,64})\.(\d{1,12})$/.exec(value ?? "");
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { id: match[1], lastSeen: Number(match[2]) };
}

export function formatVisit(visit: Visit): string {
  return `${visit.id}.${String(visit.lastSeen)}`;
}

// Secure follows the public origin, not the request: behind CloudFront and the ALB the
// app sees plain http even when the site is https.
export function visitCookieOptions(publicUrl: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(publicUrl).protocol === "https:",
    path: "/",
    maxAge: VISIT_IDLE_SECONDS,
  };
}

// The current visit id for an event's session_id, or null outside a visit.
export function visitId(cookies: {
  get(name: string): { value: string } | undefined;
}): string | null {
  return parseVisit(cookies.get(VISIT_COOKIE)?.value)?.id ?? null;
}
