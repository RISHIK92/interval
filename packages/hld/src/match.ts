import { CUPS, FAMILIES } from "./families";
import { type BattleMode, variant } from "./family";
import { POOL } from "./pool";
import { practiceProblems } from "./practice";
import type { HldProblem } from "./problem";

// P6-W42 (HLDQ-2, HLDQ-3; Q-P6-04, Q-P6-06): a match's problem: a validated variant
// from the pool, drawn at random. A match keeps (family, seed), and the seed rebuilds the
// same problem every time it's asked for (replays, disputes, scoring).

// `retired`: "<family>/<seed>" of variants a tournament used, never drawn again (HLDQ-3).
export function drawVariant(
  battleMode: BattleMode,
  random: () => number,
  retired: ReadonlySet<string>,
): { family: string; seed: number } {
  const open = (slug: string) =>
    (POOL[slug]?.[battleMode] ?? []).filter(
      (s) => !retired.has(`${slug}/${String(s)}`),
    );
  const families = FAMILIES.filter((f) => open(f.slug).length > 0);
  const family = families[Math.floor(random() * families.length)];
  if (family === undefined)
    throw new Error(`no HLD variants for the ${battleMode} mode`);
  const seeds = open(family.slug);
  const seed = seeds[Math.floor(random() * seeds.length)];
  if (seed === undefined) throw new Error(`no seeds for ${family.slug}`);
  return { family: family.slug, seed };
}

const built = new Map<string, HldProblem>();

// A pooled variant's problem, or a cup's at its seed (W44); null for anything else.
export function matchProblem(
  family: string,
  battleMode: BattleMode,
  seed: number,
): HldProblem | null {
  const cup = CUPS.find((c) => c.family.slug === family);
  const f = cup?.family ?? FAMILIES.find((x) => x.slug === family);
  const playable =
    cup === undefined
      ? (POOL[family]?.[battleMode].includes(seed) ?? false)
      : cup.seeds[battleMode] === seed;
  if (f === undefined || !playable) return null;
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
  const practice = practiceProblems().find((p) => p.slug === slug);
  if (practice !== undefined) return practice;
  const m = /^(.+)-(human|ai)-(\d+)$/.exec(slug);
  if (m === null) return null;
  const [, family = "", battleMode, seed = ""] = m;
  return matchProblem(
    family,
    battleMode === "ai" ? "ai" : "human",
    Number(seed),
  );
}
