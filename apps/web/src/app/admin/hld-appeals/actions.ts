"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { hldJudgements } from "../../../server/container";
import { textField } from "../../form";
import { requireAdmin } from "../guard";
import { gradesFrom } from "../hld-grades";

// P6-W41 (CANVAS-6, Q-P6-05): the owner re-grades an appealed judgement; the owner's
// levels replace the judge's, and the appeal joins the calibration set. Server actions
// are reachable without the page, so this checks access again.
export async function resolveAppealAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const id = z.uuid().safeParse(textField(form, "id"));
  if (!id.success) notFound();
  const appeal = (await hldJudgements().openAppeals()).find(
    (a) => a.id === id.data,
  );
  if (appeal === undefined) redirect("/admin/hld-appeals?error=resolved");
  const levels = gradesFrom(
    form,
    appeal.input.rubric.map((c) => c.id),
  );
  if (levels === null) notFound();
  const resolved = await hldJudgements().resolve(id.data, levels, actor.userId);
  redirect(
    resolved
      ? "/admin/hld-appeals?saved=1"
      : "/admin/hld-appeals?error=resolved",
  );
}
