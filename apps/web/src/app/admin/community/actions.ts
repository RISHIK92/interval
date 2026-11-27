"use server";

import { notFound, redirect } from "next/navigation";
import { adminCommunity } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// Q-P7-05: Approve makes a community question live, Reject rejects it. Server actions
// are reachable without the page, so this checks access again.
export async function decideCommunityAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const questionId = textField(form, "questionId");
  if (!BIGINT_ID.test(questionId)) notFound();
  const decision = textField(form, "decision");
  if (decision !== "approve" && decision !== "reject") notFound();
  const decided = await adminCommunity().decide(
    questionId,
    decision,
    actor.userId,
  );
  redirect(
    decided
      ? `/admin/community?saved=${decision}`
      : "/admin/community?error=decided",
  );
}
