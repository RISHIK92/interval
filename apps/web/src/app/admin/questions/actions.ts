"use server";

import { notFound, redirect } from "next/navigation";
import { adminQuestions } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// Q-2, P2-W8-S03: Keep or Retire a question in the spot-check queue. Server actions
// are reachable without the page, so this checks access again.
export async function decideAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const questionId = textField(form, "questionId");
  if (!BIGINT_ID.test(questionId)) notFound();
  const decision = textField(form, "decision");
  if (decision !== "keep" && decision !== "retire") notFound();
  const decided = await adminQuestions().decide(
    questionId,
    decision,
    actor.userId,
  );
  redirect(
    decided ? "/admin/questions?saved=1" : "/admin/questions?error=decided",
  );
}
