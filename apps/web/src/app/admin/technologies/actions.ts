"use server";

import { notFound, redirect } from "next/navigation";
import { adminTechnologies } from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// P2-W12-S03 (PER-4): accept or reject a suggested technology. Server actions are
// reachable without the page, so this checks access again.
export async function decideTechnologyAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const suggestionId = textField(form, "suggestionId");
  if (!BIGINT_ID.test(suggestionId)) notFound();
  const decision = textField(form, "decision");
  if (decision !== "accept" && decision !== "reject") notFound();
  const outcome =
    decision === "accept"
      ? await adminTechnologies().accept(suggestionId, actor.userId)
      : (await adminTechnologies().reject(suggestionId, actor.userId))
        ? "accepted"
        : "decided";
  redirect(
    outcome === "accepted"
      ? "/admin/technologies?saved=1"
      : `/admin/technologies?error=${outcome}`,
  );
}
