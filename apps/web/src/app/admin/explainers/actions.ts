"use server";

import { notFound, redirect } from "next/navigation";
import { adminExplainers } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// P4-W22-S01 (§5G, Q-P4-11): the owner approves a script before it is voiced, or rejects
// it. Server actions are reachable without the page, so this checks access again.
export async function decideExplainerAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const id = textField(form, "explainerId");
  if (!BIGINT_ID.test(id)) notFound();
  const decision = textField(form, "decision");
  if (decision !== "approved" && decision !== "rejected") notFound();
  const decided = await adminExplainers().decide(id, decision, actor.userId);
  redirect(
    decided ? "/admin/explainers?saved=1" : "/admin/explainers?error=decided",
  );
}
