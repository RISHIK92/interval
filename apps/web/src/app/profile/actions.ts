"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  events,
  feedback,
  githubAccounts,
  jobQueue,
  leaderboards,
  playerCountries,
  playerUniversities,
  preferences,
  sessionReader,
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
  await leaderboards().invalidate(found.userId, result.previous);
  if (result.previous !== country)
    events().emit("country_changed", { action: "set" }, await context(found));
  redirect("/profile?saved=country");
}

// Always allowed; the month's clock runs on.
export async function removeCountryAction(): Promise<void> {
  const found = await account();
  const previous = await playerCountries().remove(found.userId);
  await leaderboards().invalidate(found.userId, previous);
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
  if (result.previous?.id !== result.university.id)
    events().emit(
      "university_changed",
      { action: "set", listed: result.university.listed },
      await context(found),
    );
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
  if (previous !== null)
    events().emit(
      "university_changed",
      { action: "removed", listed: previous.listed },
      await context(found),
    );
  redirect("/profile?saved=university-removed");
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
