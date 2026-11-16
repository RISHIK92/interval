"use server";

import { calibrationCandidates } from "@interval/hld";
import { notFound, redirect } from "next/navigation";
import { hldJudgements } from "../../../server/container";
import { textField } from "../../form";
import { requireAdmin } from "../guard";
import { gradesFrom } from "../hld-grades";

// P6-W41 (CANVAS-6, AI-5, Q-P6-05): the owner grades one calibration design, every
// criterion at once. Server actions are reachable without the page, so this checks
// access again.
export async function gradeCandidateAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const id = textField(form, "id");
  const candidate = calibrationCandidates().find((c) => c.id === id);
  if (candidate === undefined) notFound();
  const levels = gradesFrom(
    form,
    candidate.input.rubric.map((c) => c.id),
  );
  if (levels === null) notFound();
  await hldJudgements().grade(
    candidate.id,
    Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, v.level])),
    actor.userId,
  );
  redirect(`/admin/hld-calibration?saved=${encodeURIComponent(candidate.id)}`);
}
