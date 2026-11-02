// P3-W16-S03 (MATCH-4, Q-P3-15; owner, 2026-11-03): a live match's questions, from the
// concepts both players share, then either player's goal concepts, then the whole
// bank; at the pair's level, a thin level filled from the nearest.
export type Level = "beginner" | "intermediate" | "advanced";
const LEVELS: readonly Level[] = ["beginner", "intermediate", "advanced"];

export type BankQuestion = {
  question: string;
  stem: string;
  options: string[];
  correct: number;
  level: Level | null; // none yet: one step off any level, as the sprint counts it
  concepts: string[];
};

// The pair's average rating: under 1400 beginner, 1400–1700 intermediate, over 1700
// advanced (everyone starts at 1500).
export function levelFor(averageRating: number): Level {
  if (averageRating < 1400) return "beginner";
  return averageRating > 1700 ? "advanced" : "intermediate";
}

export function pickRounds(
  bank: BankQuestion[],
  tiers: { shared: ReadonlySet<string>; goals: ReadonlySet<string> },
  level: Level,
  n: number,
  random: () => number = Math.random,
): BankQuestion[] {
  const tierOf = (q: BankQuestion) =>
    q.concepts.some((c) => tiers.shared.has(c))
      ? 0
      : q.concepts.some((c) => tiers.goals.has(c))
        ? 1
        : 2;
  const distance = (q: BankQuestion) =>
    q.level === null
      ? 1
      : Math.abs(LEVELS.indexOf(q.level) - LEVELS.indexOf(level));
  return bank
    .map((q) => ({ q, tier: tierOf(q), distance: distance(q), r: random() }))
    .sort((a, b) => a.tier - b.tier || a.distance - b.distance || a.r - b.r)
    .slice(0, n)
    .map(({ q }) => q);
}
