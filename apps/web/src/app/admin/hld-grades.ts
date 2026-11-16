import { LEVELS } from "@interval/hld";
import { z } from "zod";

// P6-W41 (Q-P6-05): the owner's grade per rubric criterion, as the appeal and
// calibration forms send them: `level:<criterion id>` (0-4) and, for appeals,
// `reason:<criterion id>`.
const Level = z.coerce.number().int().min(0).max(LEVELS);

export function gradesFrom(
  form: FormData,
  criteria: string[],
): Record<string, { level: number; reason: string }> | null {
  const out: Record<string, { level: number; reason: string }> = {};
  for (const id of criteria) {
    const raw = form.get(`level:${id}`);
    // A missing field would coerce to 0: every criterion must be chosen.
    const level = Level.safeParse(
      typeof raw === "string" && raw !== "" ? raw : NaN,
    );
    if (!level.success) return null;
    const reason = form.get(`reason:${id}`);
    out[id] = {
      level: level.data,
      reason:
        typeof reason === "string" && reason.trim() !== ""
          ? reason.trim().slice(0, 400)
          : "Graded by the owner.",
    };
  }
  return out;
}

export const LEVEL_OPTIONS = [
  "0 missing",
  "1 mentioned",
  "2 reasoned",
  "3 sound trade-off",
  "4 excellent",
];
