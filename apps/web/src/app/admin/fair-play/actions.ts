"use server";

import { notFound, redirect } from "next/navigation";
import { adminFairPlay, leaderboards } from "../../../server/container";
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
  if (decided === null) redirect("/admin/fair-play?error=decided");
  // The player's rating moved: the boards that rank by it are rebuilt.
  if (decision === "penalize") await leaderboards().invalidate(decided.userId);
  redirect("/admin/fair-play?saved=1");
}
