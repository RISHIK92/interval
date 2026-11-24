import { CUPS, FAMILIES } from "./families";
import { type BattleMode, familySpec, matchFamilies, variant } from "./family";
import { POOL } from "./pool";
import { allPracticeProblems } from "./practice";
import type { HldProblem } from "./problem";
import { specInEffect } from "./spec";

// P6-W42 (HLDQ-2, HLDQ-3; Q-P6-04, Q-P6-06): a match's problem: a validated variant
// from the pool, drawn at random. A match keeps (family, seed), and the seed rebuilds the
// same problem every time it's asked for (replays, disputes, scoring).

// `retired`: "<family>/<seed>" of variants a tournament used, never drawn again (HLDQ-3).
// Once the pools split, only battle families are drawn (ADR-0050 §1, Q-WD-31), and only
// those whose seeds' spec version is in effect at `now` (a season boundary, §6).
export function drawVariant(
  battleMode: BattleMode,
  random: () => number,
  retired: ReadonlySet<string>,
  now: Date,
): { family: string; seed: number } {
  const open = (slug: string) =>
    (POOL[slug]?.[battleMode] ?? []).filter(
      (s) => !retired.has(`${slug}/${String(s)}`),
    );
  const families = matchFamilies(FAMILIES).filter(
    (f) =>
      open(f.slug).length > 0 && specInEffect(POOL[f.slug]?.spec ?? "", now),
  );
  const family = families[Math.floor(random() * families.length)];
  if (family === undefined)
    throw new Error(`no HLD variants for the ${battleMode} mode`);
  const seeds = open(family.slug);
  const seed = seeds[Math.floor(random() * seeds.length)];
  if (seed === undefined) throw new Error(`no seeds for ${family.slug}`);
  return { family: family.slug, seed };
}

const built = new Map<string, HldProblem>();

// The spec version a family's variants are played under (ADR-0050 §6): the pool's for a
// pooled family, a cup's own; null for anything else. A match records it when made.
export function variantSpec(family: string): string | null {
  const cup = CUPS.find((c) => c.family.slug === family);
  if (cup !== undefined) return familySpec(cup.family);
  return POOL[family]?.spec ?? null;
}

// A pooled variant's problem, or a cup's at its seed (W44), under the spec version its
// match recorded; null for anything else. A family never changes its spec version
// (owner, 2026-11-24; pinned by families.test.ts), so the family's own templates and
// pool are the recorded version's: a recorded spec that isn't the family's is refused
// rather than rebuilt under different numbers.
export function matchProblem(
  family: string,
  battleMode: BattleMode,
  seed: number,
  spec: string,
): HldProblem | null {
  const cup = CUPS.find((c) => c.family.slug === family);
  const f = cup?.family ?? FAMILIES.find((x) => x.slug === family);
  const playable =
    cup === undefined
      ? (POOL[family]?.[battleMode].includes(seed) ?? false)
      : cup.seeds[battleMode] === seed;
  if (f === undefined || !playable || variantSpec(family) !== spec) return null;
  const key = `${family}/${battleMode}/${String(seed)}`;
  let problem = built.get(key);
  if (problem === undefined) {
    problem = variant(f, battleMode, seed).problem;
    built.set(key, problem);
  }
  return problem;
}

// The problem a judgement was for, by its slug: a practice problem (the family's slug)
// or a pooled variant ("<family>-<battle mode>-<seed>"); null for neither.
export function problemBySlug(slug: string): HldProblem | null {
  const practice = allPracticeProblems().find((p) => p.slug === slug);
  if (practice !== undefined) return practice;
  const m = /^(.+)-(human|ai)-(\d+)$/.exec(slug);
  if (m === null) return null;
  const [, family = "", battleMode, seed = ""] = m;
  const spec = variantSpec(family);
  return spec === null
    ? null
    : matchProblem(
        family,
        battleMode === "ai" ? "ai" : "human",
        Number(seed),
        spec,
      );
}
