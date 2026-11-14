import { FAMILIES } from "./families";
import { variant } from "./family";
import type { HldProblem } from "./problem";

// P6-W39, W40 (ADR-0042 PROPOSED, Q-P6-04): solo practice: each family's reserved
// practice seed in the human league, under the family's own slug. Built on first use,
// not at import, so the browser's bundle doesn't size eight designs it may not need.
let built: readonly HldProblem[] | null = null;

export function practiceProblems(): readonly HldProblem[] {
  built ??= FAMILIES.map((f) => {
    const seed = f.practiceSeeds[0];
    if (seed === undefined) throw new Error(`${f.slug} has no practice seed`);
    return { ...variant(f, "human", seed).problem, slug: f.slug };
  });
  return built;
}
