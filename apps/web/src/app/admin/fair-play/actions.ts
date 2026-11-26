"use server";

import { notFound, redirect } from "next/navigation";
import {
  adminFairPlay,
  jobQueue,
  leaderboards,
} from "../../../server/container";
import { queueLeaguePoints } from "../../../server/leagues";
import { BIGINT_ID } from "../../../server/ports";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// P3-W18-S02 (§6.9): dismiss a fair-play flag, or penalise it (the match's gain comes
// off the player's rating). Server actions are reachable without the page, so this
// checks access again.
export async function decideFairPlayAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const flagId = textField(form, "flagId");
  if (!BIGINT_ID.test(flagId)) notFound();
  const decision = textField(form, "decision");
  if (decision !== "dismiss" && decision !== "penalize") notFound();
  const decided = await adminFairPlay().decide(flagId, actor.userId, decision);
  // ADR-0045: a penalty's league points come off (the worker keeps AI-mode points,
  // §6.9, and ignores a dismissal). A queue that is down fails the action so the admin
  // sees it; the decision stands, and the admin's retry, finding it decided, queues
  // the same job again.
  if (decided === null) {
    if (decision === "penalize")
      await queueLeaguePoints(jobQueue(), "fair_play", flagId);
    redirect("/admin/fair-play?error=decided");
  }
  // The player's rating moved: the boards that rank by it are rebuilt.
  if (decision === "penalize") {
    await leaderboards().invalidate(decided.userId);
    await queueLeaguePoints(jobQueue(), "fair_play", flagId);
  }
  redirect("/admin/fair-play?saved=1");
}
