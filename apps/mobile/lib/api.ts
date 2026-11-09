import { Platform } from "react-native";
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
      // Q-P4-14: the app's events name its platform.
      "interval-platform": Platform.OS,
      cookie: await authClient.getCookie(),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

// P4-W21-S01: an answer from the site's API, checked against its shared schema; the
// statuses the screens tell apart. Failures are logged here, once.
export type Got<T> =
  | { status: "ok"; value: T }
  // conflict: a 409, which each route gives its meaning (too late; set up first).
  | { status: "conflict" | "none" | "forbidden" | "failed" };

// The shared schemas' safeParse, without the app importing zod itself.
type Schema<T> = {
  safeParse: (
    raw: unknown,
  ) =>
    { success: true; data: T } | { success: false; error: { message: string } };
};

export async function got<T>(
  response: Response,
  schema: Schema<T>,
  what: string,
): Promise<Got<T>> {
  if (response.status === 409) return { status: "conflict" };
  if (response.status === 404) return { status: "none" };
  if (response.status === 403) return { status: "forbidden" };
  if (!response.ok) {
    console.warn(`${what}: not read`, response.status);
    return { status: "failed" };
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    console.warn(`${what}: not one`, parsed.error.message);
    return { status: "failed" };
  }
  return { status: "ok", value: parsed.data };
}
