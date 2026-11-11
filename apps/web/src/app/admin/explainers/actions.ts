"use server";

import { notFound, redirect } from "next/navigation";
import {
  adminExplainers,
  adminScenes,
  mediaFiles,
} from "../../../server/container";
import { BIGINT_ID } from "../../../server/ports";
import { textField } from "../../form";
import { requireAdmin } from "../guard";
import { loadTimeline } from "./scene";

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

// P4.5-W26-S02 (AI-1, Q-P4.5-03): a drafted scene timeline approved or rejected. Approval
// reads the file again and holds it to every rule, whatever the page showed.
export async function decideSceneAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const id = textField(form, "sceneId");
  if (!BIGINT_ID.test(id)) notFound();
  const decision = textField(form, "decision");
  if (decision !== "approved" && decision !== "rejected") notFound();
  if (decision === "approved") {
    const scene = await adminScenes().scene(id);
    if (scene === null) redirect("/admin/explainers?error=decided");
    const loaded = await loadTimeline(
      mediaFiles(),
      scene.key,
      scene.captions.length,
    );
    if ("problems" in loaded) redirect("/admin/explainers?error=scene");
  }
  const decided = await adminScenes().decide(id, decision, actor.userId);
  redirect(
    decided ? "/admin/explainers?saved=1" : "/admin/explainers?error=decided",
  );
}
