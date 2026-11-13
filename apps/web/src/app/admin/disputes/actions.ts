"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { adminDisputes } from "../../../server/container";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// P5-W35 (Q-P5-22): uphold or dismiss a disputed battle result, with a note. Nothing
// changes a rating by itself: a correction is the owner's to make. Server actions are
// reachable without the page, so this checks access again.
const Decision = z.object({
  matchId: z.uuid(),
  userId: z.string().min(1).max(200),
  decision: z.enum(["upheld", "dismissed"]),
  note: z.string().trim().max(1000),
});

export async function decideDisputeAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const parsed = Decision.safeParse({
    matchId: textField(form, "matchId"),
    userId: textField(form, "userId"),
    decision: textField(form, "decision"),
    note: textField(form, "note"),
  });
  if (!parsed.success) notFound();
  const { matchId, userId, decision, note } = parsed.data;
  const decided = await adminDisputes().decide(
    matchId,
    userId,
    decision,
    note,
    actor.userId,
  );
  redirect(
    decided ? "/admin/disputes?saved=1" : "/admin/disputes?error=decided",
  );
}
