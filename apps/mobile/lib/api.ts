import { SITE, authClient } from "./auth";

// P4-W19-S04a: the app's calls to the site's API, with the session cookie (Better Auth's
// Expo plugin keeps it) and expo-origin, which the server takes in place of an Origin.
export async function api(
  path: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  return fetch(`${SITE}${path}`, {
    method: init.method,
    // The cookie is ours to send: React Native's shared jar (the WebView's on iOS) would
    // otherwise add its own, stale or duplicated (Better Auth's Expo client does the same).
    credentials: "omit",
    headers: {
      "content-type": "application/json",
      "expo-origin": "interval://",
      cookie: await authClient.getCookie(),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}
