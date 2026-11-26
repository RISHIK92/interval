"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  events,
  explore,
  feedReader,
  jobQueue,
  preferences,
  sessionReader,
} from "../../server/container";
import { followedTopics } from "../../server/explore";
import { type Actor, BIGINT_ID, isTopic } from "../../server/ports";
import { offeredTopics } from "../../server/preferences";
import { queueRecompute } from "../../server/recompute";
import { visitId } from "../../server/visits";
import { textField } from "../form";

// ADR-0046: Explore's follow buttons and the gap card's dismissal.

async function account(): Promise<Actor> {
  const found = await sessionReader().current(await headers());
  if (found === null) redirect("/join");
  // ADR-0029: guests play, and only play.
  if (found.isGuest) redirect("/sign-up");
  return found;
}

// Following a space edits the same explicit topics as onboarding and Profile (PER-1),
// so the feed follows it on the recompute this queues (Q-P1-17).
export async function followSpaceAction(form: FormData): Promise<void> {
  const actor = await account();
  const topic = textField(form, "topic");
  const follow = textField(form, "follow") === "true";
  const back =
    textField(form, "back") === "all" ? "/explore?spaces=all" : "/explore";
  if (!isTopic(topic)) redirect(back);
  const chosen = await preferences().get(actor.userId);
  if (chosen === null) redirect("/onboarding");
  const topics = followedTopics(
    chosen.topics,
    topic,
    follow,
    await offeredTopics(feedReader()),
  );
  if (topics === null) redirect(back);
  if (topics.length !== chosen.topics.length) {
    await preferences().update(actor.userId, {
      goals: chosen.goals,
      topics,
      level: chosen.level,
      breakLength: chosen.breakLength,
    });
    await queueRecompute(
      jobQueue(),
      actor.userId,
      `explore-${actor.userId}-${randomUUID()}`,
      "feed: recompute after a space change not queued",
    );
    events().emit(
      follow ? "space_followed" : "space_unfollowed",
      { topic },
      { ...actor, sessionId: visitId(await cookies()) },
    );
  }
  redirect(back);
}

// Stored per user and concept: that gap is never shown again.
export async function dismissGapAction(form: FormData): Promise<void> {
  const actor = await account();
  const concept = textField(form, "concept");
  if (BIGINT_ID.test(concept)) {
    await explore().dismissGap(actor.userId, concept);
    events().emit(
      "gap_dismissed",
      { concept_id: concept },
      { ...actor, sessionId: visitId(await cookies()) },
    );
  }
  redirect("/explore");
}
