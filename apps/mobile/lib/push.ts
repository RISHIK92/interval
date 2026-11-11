import { PushPreferences } from "@interval/api-client";
import * as Notifications from "expo-notifications";
import { api, got } from "./api";

// P4-W19-S04a (Q-P4-03): this phone's push token, registered with the site on the user's
// tap (never asked unprompted); the worker sends through APNs or FCM (S04b).
export type PushResult =
  | { status: "on"; token: string }
  | { status: "blocked" | "not-on-plan" | "failed" };

async function phoneToken(): Promise<{
  platform: "ios" | "android";
  token: string;
} | null> {
  const device = await Notifications.getDevicePushTokenAsync();
  if (device.type !== "ios" && device.type !== "android") {
    console.warn("push: not a phone's token", device.type);
    return null;
  }
  return { platform: device.type, token: String(device.data) };
}

export async function enablePush(): Promise<PushResult> {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { status: "blocked" };
  const phone = await phoneToken();
  if (phone === null) return { status: "failed" };
  const response = await api("/api/push/device", {
    method: "POST",
    body: phone,
  });
  if (response.status === 403) return { status: "not-on-plan" };
  if (!response.ok) {
    console.warn("push: not registered", response.status);
    return { status: "failed" };
  }
  return { status: "on", token: phone.token };
}

export async function disablePush(token: string): Promise<boolean> {
  const response = await api("/api/push/device", {
    method: "DELETE",
    body: { token },
  });
  if (!response.ok) console.warn("push: not removed", response.status);
  return response.ok;
}

// The phone's token when its notifications are allowed: only this app's button asks, and
// it registers what it gets, so a granted phone counts as on (a failed register is
// harmless to remove). Asks nothing.
export async function currentPush(): Promise<string | null> {
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return null;
  return (await phoneToken())?.token ?? null;
}

// Before signing out: the phone stops getting this account's pushes. Best effort.
export async function forgetThisPhone(): Promise<void> {
  try {
    const token = await currentPush();
    if (token !== null) await disablePush(token);
  } catch (error) {
    console.warn("push: not removed at sign out", error);
  }
}

// P4-W24-S01 (Q-P4-13): which pushes and when, saved with the phone's time zone so the
// hour is the user's own. A 403 is a plan without push (ADR-0036).
// Never throws: Profile reads it on open, offline included.
export const readPushSettings = () =>
  api("/api/push/preferences", { method: "GET" })
    .then((response) => got(response, PushPreferences, "push settings"))
    .catch((error: unknown) => {
      console.warn("push settings: not read", error);
      return { status: "failed" as const };
    });

export async function savePushSettings(
  next: PushPreferences,
): Promise<boolean> {
  const response = await api("/api/push/preferences", {
    method: "PUT",
    body: {
      ...next,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  }).catch((error: unknown) => {
    console.warn("push settings: not sent", error);
    return null;
  });
  if (response !== null && !response.ok)
    console.warn("push settings: not saved", response.status);
  return response?.ok === true;
}
