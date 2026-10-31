// The worker's validator agrees within the same band (workers/jobs questions.py
// ESTIMATE_AGREES): change both together.
const FULL = 1.25;
const NONE = 10;

// C-27 (ADR-0006, §6.3): an estimate's share of the points, 0 to 1. Full within
// 1.25× of the answer either way, falling linearly in log space to 0 at 10× off, so
// guessing double is as good as guessing half.
export function estimateScore(guess: number, answer: number): number {
  if (!(guess > 0) || !Number.isFinite(guess)) return 0;
  // The ratio, not its log, decides the ends: log(0.1) isn't exactly -log(10).
  const off = Math.max(guess / answer, answer / guess);
  if (off <= FULL) return 1;
  if (off >= NONE) return 0;
  return 1 - Math.log(off / FULL) / Math.log(NONE / FULL);
}

// P3-W13-S04 (owner, 2026-10-31): a round shows up to 100 points an answer, and an
// answer under half points (about 3.5× off) sends its source back to reading (§6.1).
export const points = (score: number): number => Math.round(score * 100);
export const missed = (score: number): boolean => score < 0.5;
