import { env } from "../env";

// A POST from the site itself (P2-W11-S01, S04): another site can't act for a
// signed-in user. In development the site is also reached on 127.0.0.1 beside
// localhost (next.config's allowedDevOrigins); Next reports the request's URL as
// localhost either way, so the browser's Host header is what the origin must match.
// P4-W19-S04a: the native app's requests carry no Origin; they send expo-origin (as
// Better Auth's Expo plugin does) instead. Another site can't add a custom header to a
// cross-site request without a CORS preflight, which nothing here allows.
export function fromSiteOrApp(request: Request): boolean {
  return (
    sameOrigin(request) ||
    (request.headers.get("origin") === null &&
      request.headers.get("expo-origin") === "interval://")
  );
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === new URL(env().BETTER_AUTH_URL).origin) return true;
  const host = request.headers.get("host");
  return (
    env().NODE_ENV === "development" &&
    origin !== null &&
    host !== null &&
    // "null" (a sandboxed frame) and anything unparsable are not the site.
    URL.canParse(origin) &&
    new URL(origin).host === host
  );
}
