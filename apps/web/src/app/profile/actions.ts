"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  feedback,
  jobQueue,
  preferences,
  sessionReader,
} from "../../server/container";
import { queueRecompute } from "../../server/recompute";
import { BIGINT_ID } from "../../server/ports";
import { updatePreferences } from "../../server/preferences";
import { textField } from "../form";

// The Profile page (§5A, PER-1, Q-P1-36, P1-W4-S08): each change takes effect in the
// feed on the recompute it queues (Q-P1-17).

async function actor(): Promise<string> {
  const found = await sessionReader().current(await headers());
  if (found === null) redirect("/join");
  return found.userId;
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
    topics: form.getAll("topic").filter((v) => typeof v === "string"),
    level: textField(form, "level"),
    breakLength: textField(form, "breakLength"),
  });
  if (!result.ok) redirect(`/profile?missing=${result.field}`);
  if (!result.updated) redirect("/onboarding");
  await recompute(userId);
  redirect("/profile?saved=choices");
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
