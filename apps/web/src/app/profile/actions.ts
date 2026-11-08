"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  agentHook,
  events,
  feedback,
  githubAccounts,
  jobQueue,
  leaderboards,
  playerCountries,
  follows,
  playerUniversities,
  preferences,
  sessionReader,
  usernames,
  entitlements,
} from "../../server/container";
import { COUNTRY_CODES } from "../../server/countries";
import { queueRecompute } from "../../server/recompute";
import {
  type Actor,
  BIGINT_ID,
  type UniversityChange,
} from "../../server/ports";
import { updatePreferences } from "../../server/preferences";
import { log } from "../../server/log";
import { visitId } from "../../server/visits";
import { universityName } from "../../server/universities";
import { usernameOf } from "../../server/usernames";
import { textField } from "../form";

// The Profile page (§5A, PER-1, Q-P1-36, P1-W4-S08): each change takes effect in the
// feed on the recompute it queues (Q-P1-17).

async function account(): Promise<Actor> {
  const found = await sessionReader().current(await headers());
  if (found === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (found.isGuest) redirect("/sign-up");
  return found;
}

async function actor(): Promise<string> {
  return (await account()).userId;
}

async function context(found: Actor) {
  return { ...found, sessionId: visitId(await cookies()) };
}

async function recompute(userId: string): Promise<void> {
  await queueRecompute(
    jobQueue(),
    userId,
    `profile-${userId}-${randomUUID()}`,
    "feed: recompute after a profile change not queued",
  );
}

export async function updatePreferencesAction(form: FormData): Promise<void> {
  const userId = await actor();
  const result = await updatePreferences(preferences(), userId, {
    goals: form.getAll("goal").filter((v) => typeof v === "string"),
    topics: form.getAll("topic").filter((v) => typeof v === "string"),
    level: textField(form, "level"),
    breakLength: textField(form, "breakLength"),
  });
  if (!result.ok) redirect(`/profile?missing=${result.field}`);
  if (!result.updated) redirect("/onboarding");
  await recompute(userId);
  redirect("/profile?saved=choices");
}

// P3-W14-S02 (§6.7, Q-P3-08; owner, 2026-11-02): the player's country, at most once
// in 30 days; its boards and the old country's are worked out again.
export async function setCountryAction(form: FormData): Promise<void> {
  const found = await account();
  const country = textField(form, "country");
  if (!COUNTRY_CODES.has(country)) redirect("/profile");
  const result = await playerCountries().set(found.userId, country);
  if (!result.ok) redirect("/profile?country=soon");
  await leaderboards().invalidate(
    found.userId,
    result.previous === null ? [] : [{ country: result.previous }],
  );
  if (result.previous !== country)
    events().emit("country_changed", { action: "set" }, await context(found));
  redirect("/profile?saved=country");
}

// Always allowed; the month's clock runs on.
export async function removeCountryAction(): Promise<void> {
  const found = await account();
  const previous = await playerCountries().remove(found.userId);
  await leaderboards().invalidate(
    found.userId,
    previous === null ? [] : [{ country: previous }],
  );
  if (previous !== null)
    events().emit(
      "country_changed",
      { action: "removed" },
      await context(found),
    );
  redirect("/profile?saved=country-removed");
}

// P3-W14-S03 (§6.7, ADR-0032; owner, 2026-11-02): the player's university, picked
// from the list or typed; unverified, no email. At most once in 30 days.
async function universityChanged(
  found: Actor,
  result: UniversityChange,
): Promise<never> {
  if (!result.ok)
    redirect(
      result.reason === "soon" ? "/profile?university=soon" : "/profile",
    );
  if (result.previous?.id !== result.university.id) {
    // P3-W14-S04: its boards, and the averages of both universities.
    await leaderboards().invalidate(
      found.userId,
      result.previous === null ? [] : [{ university: result.previous.id }],
    );
    events().emit(
      "university_changed",
      { action: "set", listed: result.university.listed },
      await context(found),
    );
  }
  redirect("/profile?saved=university");
}

export async function chooseUniversityAction(form: FormData): Promise<void> {
  const found = await account();
  const universityId = textField(form, "universityId");
  if (!BIGINT_ID.test(universityId)) redirect("/profile");
  await universityChanged(
    found,
    await playerUniversities().set(found.userId, universityId),
  );
}

export async function typeUniversityAction(form: FormData): Promise<void> {
  const found = await account();
  const name = universityName(textField(form, "name"));
  if (name === null) redirect("/profile?university=name");
  await universityChanged(
    found,
    await playerUniversities().setTyped(found.userId, name),
  );
}

// Always allowed; the month's clock runs on.
export async function removeUniversityAction(): Promise<void> {
  const found = await account();
  const previous = await playerUniversities().remove(found.userId);
  if (previous !== null) {
    await leaderboards().invalidate(found.userId, [
      { university: previous.id },
    ]);
    events().emit(
      "university_changed",
      { action: "removed", listed: previous.listed },
      await context(found),
    );
  }
  redirect("/profile?saved=university-removed");
}

// P3-W14-S05 (§6.7, Q-P3-11; owner, 2026-11-02): one-way follows, no accept step. A
// player picked from search or a list (`userId`), or typed by exact username.
export async function followAction(form: FormData): Promise<void> {
  const found = await account();
  // Actions skip the page's gate: a follower without a username would be hidden from
  // the full followers list, so it picks one first.
  if ((await usernames().get(found.userId)) === null)
    redirect("/username?next=%2Fprofile");
  const typed = textField(form, "username");
  let target: string | null;
  if (typed === "") {
    const userId = textField(form, "userId");
    // Only players with a username are followed (and the id is real).
    target =
      userId !== "" && (await usernames().get(userId)) !== null ? userId : null;
  } else {
    const username = usernameOf(typed);
    target = username === null ? null : await usernames().byName(username);
  }
  if (target === null) redirect("/profile?friend=nobody#friends");
  if (target === found.userId) redirect("/profile?friend=self#friends");
  if (await follows().follow(found.userId, target))
    events().emit("player_followed", {}, await context(found));
  redirect("/profile?saved=followed#friends");
}

export async function unfollowAction(form: FormData): Promise<void> {
  const found = await account();
  if (await follows().unfollow(found.userId, textField(form, "userId")))
    events().emit("player_unfollowed", {}, await context(found));
  redirect("/profile?saved=unfollowed#friends");
}

// Found in people search unless turned off; following by exact username works anyway.
export async function searchableAction(form: FormData): Promise<void> {
  const userId = await actor();
  const on = textField(form, "searchable") === "on";
  await usernames().setSearchable(userId, on);
  redirect(`/profile?saved=${on ? "search-on" : "search-off"}#friends`);
}

export async function resetInferredAction(): Promise<void> {
  const userId = await actor();
  await feedback().resetInferred(userId);
  await recompute(userId);
  redirect("/profile?saved=reset");
}

export async function unhideSourceAction(form: FormData): Promise<void> {
  const userId = await actor();
  const sourceId = textField(form, "sourceId");
  if (!BIGINT_ID.test(sourceId)) redirect("/profile");
  if (await feedback().unhideSource(userId, sourceId)) await recompute(userId);
  redirect("/profile?saved=unhidden");
}

// P2-W12-S02: the user's repositories read again, at most once a minute (the key).
export async function refreshGitHubAction(): Promise<void> {
  const found = await sessionReader().current(await headers());
  if (found === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (found.isGuest) redirect("/sign-up");
  if ((await githubAccounts().get(found.userId)) === null) redirect("/profile");
  const minute = Math.floor(Date.now() / 60_000);
  try {
    await jobQueue().enqueue(
      "github_sync",
      { user_id: found.userId },
      { idempotencyKey: `github-sync-${found.userId}-m${String(minute)}` },
    );
  } catch (error) {
    // LOAD-5: the daily read catches up; said, not hidden.
    log.error("github: refresh not queued", { userId: found.userId, error });
    redirect("/profile?github=refresh-failed");
  }
  redirect("/profile?saved=github-refresh");
}

// P2-W12-S01 (§5H, ADR-0024): Interval's copy of the user's GitHub data is deleted; the
// App stays installed until they uninstall it on GitHub, which the page explains.
export async function disconnectGitHubAction(): Promise<void> {
  const found = await sessionReader().current(await headers());
  if (found === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (found.isGuest) redirect("/sign-up");
  if (!(await githubAccounts().disconnect(found.userId))) redirect("/profile");
  // P2-W12-S04: the feed's project picks go with the data.
  await recompute(found.userId);
  events().emit(
    "github_disconnected",
    {},
    { ...found, sessionId: visitId(await cookies()) },
  );
  redirect("/profile?saved=github-off");
}

// P3-W17-S04 (§7, Q-P3-28): a device for the agent hook, named; its token comes back
// this once (it's kept only as a hash) and never travels in a URL.
export type DeviceState =
  { token: string; name: string } | { message: string } | null;

export async function addAgentDeviceAction(
  _previous: DeviceState,
  form: FormData,
): Promise<DeviceState> {
  const userId = await actor();
  // ADR-0036: revoking stays open, so a user whose plan dropped it can clean up.
  if (!(await entitlements().can(userId, "agent.hook")))
    return { message: "The agent hook isn't on your plan." };
  const name = textField(form, "name").trim();
  if (name.length < 1 || name.length > 40)
    return { message: "Name the device in 1 to 40 characters." };
  const added = await agentHook().addDevice(userId, name);
  if (added === "full")
    return { message: "You have 10 devices: revoke one to add another." };
  revalidatePath("/profile");
  return { token: added.token, name: added.device.name };
}

export async function revokeAgentDeviceAction(form: FormData): Promise<void> {
  const userId = await actor();
  const device = z.uuid().safeParse(textField(form, "device"));
  if (device.success) await agentHook().revoke(userId, device.data);
  revalidatePath("/profile");
}
