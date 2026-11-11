import type { PushPreferencesBody } from "@interval/api-client";
import { events, pushSettings } from "./container";
import type { EventContext } from "./events";

// P4-W24-S01 (Q-P4-13): a named IANA zone, in Intl's own spelling ("asia/kolkata" is
// stored as "Asia/Kolkata"): the worker's zoneinfo is case-sensitive on Linux, and
// knows no bare offsets ("+05:30"), which Intl accepts. null: not a zone.
export function canonicalZone(zone: string): string | null {
  try {
    const name = new Intl.DateTimeFormat("en", {
      timeZone: zone,
    }).resolvedOptions().timeZone;
    return /^[+-]/.test(name) ? null : name;
  } catch {
    return null;
  }
}

// The kinds turned on or off count toward the opt-in metric (DB-5, W24-S02). The zone is
// already canonical (canonicalZone).
export async function savePushPreferences(
  context: EventContext,
  body: PushPreferencesBody,
): Promise<void> {
  const { timeZone, ...preferences } = body;
  const changed = await pushSettings().save(
    context.userId,
    preferences,
    timeZone,
  );
  for (const change of changed) {
    events().emit("push_setting_changed", change, context);
  }
}
