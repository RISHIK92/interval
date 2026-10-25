"use server";

import { notFound, redirect } from "next/navigation";
import { switchMoments } from "../../../server/admin-sources";
import { adminSources, jobQueue } from "../../../server/container";
import { textField } from "../../form";
import { requireAdmin } from "../guard";

// Server actions are reachable without the page, so this checks access again.
export async function switchMomentsAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const sourceId = textField(form, "sourceId");
  if (!/^\d{1,18}$/.test(sourceId)) notFound();
  const choice = textField(form, "switch");
  if (choice !== "on" && choice !== "off") notFound();
  const off = choice === "off";
  const result = await switchMoments(
    adminSources(),
    jobQueue(),
    actor.userId,
    sourceId,
    off,
  );
  redirect(
    result.ok ? "/admin/sources?saved=1" : "/admin/sources?error=no-source",
  );
}
