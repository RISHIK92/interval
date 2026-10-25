"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { events, preferences, sessionReader } from "../../server/container";
import { completeOnboarding } from "../../server/preferences";
import { visitId } from "../../server/visits";
import { textField } from "../form";

export async function onboardingAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const result = await completeOnboarding(preferences(), actor.userId, {
    topics: form.getAll("topic").filter((v) => typeof v === "string"),
    level: textField(form, "level"),
    breakLength: textField(form, "breakLength"),
  });
  if (!result.ok) redirect(`/onboarding?missing=${result.field}`);
  // Once per user: a resubmit (back button, double click) changes and counts nothing.
  if (result.created) {
    events().emit(
      "onboarding_completed",
      {},
      { ...actor, sessionId: visitId(await cookies()) },
    );
  }
  redirect("/");
}
