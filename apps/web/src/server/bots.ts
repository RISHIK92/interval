import type { GameMode, GhostAnswer } from "./ports";

// P3-W17-S02 (BOT-2, Q-P3-26; owner, 2026-11-03): a synthetic bot's run, built from each
// question's real correct rate and real live answer times. It is handed to the game
// server as a replay, the same way as a ghost's (S01).

export type BotQuestion = {
  correct: number; // the key
  options: number; // how many options
  level: "beginner" | "intermediate" | "advanced" | null;
  answers: number; // recorded answers to it
  rightRate: number; // of those, the share right
  times: number[]; // its live answer times, ms
};

const MIN_ANSWERS = 20; // fewer: the rate by level instead
const MIN_TIMES = 5; // fewer: the mode's times instead
// Owner, 2026-11-03 (Q-P3-26): no level counts as intermediate too.
const RATE_BY_LEVEL = { beginner: 0.8, intermediate: 0.65, advanced: 0.5 };
const NO_TIMES_MS = [3_000, 9_000]; // with no live times at all

// One of `from` at random; none (and no draw) when it's empty.
const pick = <T>(from: T[], random: () => number): T | undefined =>
  from.length === 0
    ? undefined
    : from[Math.min(from.length - 1, Math.floor(random() * from.length))];

// Each question in order: right or a random wrong option, at a drawn time. A sprint's
// times add up from its start; fastest finger's are each from its round's start.
export function botAnswers(
  questions: BotQuestion[],
  modeTimes: number[],
  mode: GameMode,
  random: () => number = Math.random,
): GhostAnswer[] {
  let clock = 0;
  return questions.map((q, i) => {
    const rate =
      q.answers >= MIN_ANSWERS
        ? q.rightRate
        : RATE_BY_LEVEL[q.level ?? "intermediate"];
    const wrongs = Array.from({ length: q.options }, (_, o) => o).filter(
      (o) => o !== q.correct,
    );
    const choice =
      random() < rate ? q.correct : (pick(wrongs, random) ?? q.correct);
    const pool = q.times.length >= MIN_TIMES ? q.times : modeTimes;
    const [low, high] = NO_TIMES_MS as [number, number];
    const took =
      pick(pool, random) ?? Math.round(low + random() * (high - low));
    clock = mode === "sprint" ? clock + took : took;
    return { n: i + 1, choice, ms: clock };
  });
}
