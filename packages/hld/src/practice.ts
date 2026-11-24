import { FAMILIES } from "./families";
import { practiceFamilies, variant } from "./family";
import type { HldProblem } from "./problem";
import { specInEffect } from "./spec";

// P6-W39, W40 (ADR-0042 PROPOSED, Q-P6-04): solo practice: each practice family's
// reserved practice seed in the human mode, under the family's own slug (ADR-0050 §1:
// every family until the pools split, Q-WD-31). Built on first use,
// not at import, so the browser's bundle doesn't size eight designs it may not need.
let built: readonly HldProblem[] | null = null;

// Every practice problem, whether or not its spec version is in effect yet: what a
// judgement already asked for is found by its slug.
export function allPracticeProblems(): readonly HldProblem[] {
  built ??= practiceFamilies(FAMILIES).map((f) => {
    const seed = f.practiceSeeds?.[0];
    if (seed === undefined) throw new Error(`${f.slug} has no practice seed`);
    return { ...variant(f, "human", seed).problem, slug: f.slug };
  });
  return built;
}

// ADR-0050 §6, Q-WD-31: what practice offers at `now`: a family on a spec version
// joins at that version's season boundary, as it does matches.
export function practiceProblems(now: Date): readonly HldProblem[] {
  return allPracticeProblems().filter((p) => specInEffect(p.spec, now));
}
