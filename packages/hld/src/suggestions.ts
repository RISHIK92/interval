import { createHash } from "node:crypto";
import { z } from "zod";
import file from "./calibration-suggestions.json";
import { FAMILIES } from "./families";
import { familySpec } from "./family";
import { type CalibrationCandidate, type JudgeInput, Levels } from "./judge";

// Owner decision 2026-11-24 (CANVAS-6, AI-5): Claude drafted a suggested level, with a
// one-line reason, for each criterion of each calibration design. The admin page shows
// them beside the grade inputs; a suggestion becomes a grade only when the owner accepts
// it, and the judge eval reads the owner's grades alone. Q-WD-32: each suggestion
// carries the fingerprint of the design it was written for, so one written for a design
// that has since changed is caught rather than offered. Its own entry point
// (`@interval/hld/suggestions`): it hashes with node:crypto, which the browser bundles
// of the package's other exports can't load.
const Suggestion = z.strictObject({
  fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  levels: Levels,
});
const SuggestionsFile = z.strictObject({
  about: z.string(),
  author: z.literal("claude"),
  status: z.literal("PROVISIONAL"),
  suggestions: z.record(z.string(), Suggestion),
});
type CalibrationSuggestion = z.infer<typeof Suggestion>;

// Sorted keys at every depth, so the same design always hashes the same.
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(",")}}`
      : JSON.stringify(value);

// The whole judge input, not only components and connections: a changed requirement,
// rubric or simulation result changes what a grade should be, too.
export function calibrationFingerprint(
  slug: string,
  spec: string,
  input: JudgeInput,
): string {
  return createHash("sha256")
    .update(canonical({ slug, spec, input }))
    .digest("hex")
    .slice(0, 16);
}

export function candidateFingerprint(candidate: CalibrationCandidate): string {
  const family = FAMILIES.find((f) => f.slug === candidate.family);
  if (family === undefined) throw new Error(`no family ${candidate.family}`);
  return calibrationFingerprint(
    candidate.family,
    familySpec(family),
    candidate.input,
  );
}

let parsed: Map<string, CalibrationSuggestion> | undefined;

export function calibrationSuggestions(): Map<string, CalibrationSuggestion> {
  parsed ??= new Map(Object.entries(SuggestionsFile.parse(file).suggestions));
  return parsed;
}

// A candidate's suggestion: its levels when written for the design as it is now,
// "outdated" when the design has changed since, undefined when there is none.
export function currentSuggestion(
  candidate: CalibrationCandidate,
): Levels | "outdated" | undefined {
  const s = calibrationSuggestions().get(candidate.id);
  if (s === undefined) return undefined;
  return s.fingerprint === candidateFingerprint(candidate)
    ? s.levels
    : "outdated";
}
