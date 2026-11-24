"use server";

import { calibrationCandidates } from "@interval/hld";
import { currentSuggestion } from "@interval/hld/suggestions";
import { notFound, redirect } from "next/navigation";
import { hldJudgements } from "../../../server/container";
import { textField } from "../../form";
import { requireAdmin } from "../guard";
import { ACCEPT_ALL, gradesFrom } from "../hld-grades";

// P6-W41 (CANVAS-6, AI-5, Q-P6-05): the owner grades one calibration design, every
// criterion at once. Server actions are reachable without the page, so this checks
// access again. An "accept" button (owner decision 2026-11-24) grades one criterion, or
// every one, at Claude's suggested level: the stored grade is the owner's act, and the
// level comes from the suggestions file, never from the form, so it is the one shown;
// an outdated suggestion (Q-WD-32) is never shown, so it can't be accepted either.
export async function gradeCandidateAction(form: FormData): Promise<void> {
  const actor = await requireAdmin();
  const id = textField(form, "id");
  const candidate = calibrationCandidates().find((c) => c.id === id);
  if (candidate === undefined) notFound();
  const criteria = candidate.input.rubric.map((c) => c.id);
  const accept = form.get("accept");
  let levels: Record<string, number>;
  if (typeof accept === "string" && accept !== "") {
    const suggestion = currentSuggestion(candidate);
    const suggested = suggestion === "outdated" ? undefined : suggestion;
    const chosen = accept === ACCEPT_ALL ? criteria : [accept];
    const picked = chosen.flatMap((c): [string, number][] => {
      const s = suggested?.[c];
      return s === undefined || !criteria.includes(c) ? [] : [[c, s.level]];
    });
    if (picked.length !== chosen.length) notFound();
    levels = Object.fromEntries(picked);
  } else {
    const given = gradesFrom(form, criteria);
    if (given === null) notFound();
    levels = Object.fromEntries(
      Object.entries(given).map(([k, v]) => [k, v.level]),
    );
  }
  await hldJudgements().grade(candidate.id, levels, actor.userId);
  const filter = form.get("filter") === "ungraded" ? "filter=ungraded&" : "";
  redirect(
    `/admin/hld-calibration?${filter}saved=${encodeURIComponent(candidate.id)}`,
  );
}
