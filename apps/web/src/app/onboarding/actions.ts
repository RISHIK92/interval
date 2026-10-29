"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  books,
  events,
  githubAccounts,
  jobQueue,
  preferences,
  sessionReader,
} from "../../server/container";
import { queueRecompute } from "../../server/recompute";
import { completeOnboarding } from "../../server/preferences";
import { visitId } from "../../server/visits";
import { textField } from "../form";

export async function onboardingAction(form: FormData): Promise<void> {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const result = await completeOnboarding(preferences(), actor.userId, {
    goals: form.getAll("goal").filter((v) => typeof v === "string"),
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
  // The first feed (Q-P1-17, ADR-0008): the home page waits briefly for this job. If the
  // queue is down, the starter feed shows and the hourly pass computes it (LOAD-5).
  await queueRecompute(
    jobQueue(),
    actor.userId,
    `onboarding-recompute-${actor.userId}`,
    "feed: first recompute not queued",
  );
  // Q-P2-36 (owner): the book goal leads to adding a book; a guest finds there that
  // books need an account.
  if (
    form.getAll("goal").includes("finish-that-book") && // validated above
    (await books().list(actor.userId)).length === 0
  )
    redirect("/books/new");
  // P2-W12-S04 (ADR-0015): the stack goal needs a project; connect GitHub first.
  if (
    !actor.isGuest &&
    form.getAll("goal").includes("stack-i-use") &&
    (await githubAccounts().get(actor.userId)) === null
  )
    redirect("/profile#github");
  redirect("/");
}
