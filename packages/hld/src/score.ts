import { SIMULATION_POINTS } from "./simulate";
import { RUBRIC_POINTS } from "./judge";

// P6-W42 (§6.4; Q-P6-06): an HLD match's score. Simulation 60, rubric 25, speed 15. A
// design that fails the baseline earns no rubric or speed points; one auto-submitted at
// the deadline earns no speed. If any player's judgement is missing, the rubric is left
// out for everyone and the rest is scaled to 100, so nobody wins or loses on an outage.

const SPEED_POINTS = 15;
const ALL = SIMULATION_POINTS + RUBRIC_POINTS + SPEED_POINTS;

export function speedPoints(
  startedAt: Date,
  submittedAt: Date,
  timeLimitMinutes: number,
  baselinePassed: boolean,
  auto: boolean,
): number {
  if (!baselinePassed || auto) return 0;
  const limit = timeLimitMinutes * 60_000;
  const left = Math.max(
    0,
    limit - (submittedAt.getTime() - startedAt.getTime()),
  );
  return Math.round(((SPEED_POINTS * left) / limit) * 10) / 10;
}

export type Entry = {
  userId: string;
  simulation: number;
  speed: number;
  rubric: number | null; // null: not judged (failed the baseline, or unavailable)
  baselinePassed: boolean;
  submittedAt: Date;
};

export type Standing = { userId: string; total: number; place: number };

// Totals and places: the higher total first; a tie goes to whoever submitted first, and
// an exact tie shares the place.
export function standings(
  entries: Entry[],
  rubricIncluded: boolean,
): Standing[] {
  const scale = rubricIncluded ? 1 : ALL / (ALL - RUBRIC_POINTS);
  const totals = entries.map((e) => ({
    e,
    total:
      Math.round(
        (e.simulation +
          e.speed +
          (rubricIncluded && e.baselinePassed ? (e.rubric ?? 0) : 0)) *
          scale *
          10,
      ) / 10,
  }));
  totals.sort(
    (a, b) =>
      b.total - a.total ||
      a.e.submittedAt.getTime() - b.e.submittedAt.getTime(),
  );
  return totals.map((t, i) => {
    const first = totals.findIndex(
      (u) =>
        u.total === t.total &&
        u.e.submittedAt.getTime() === t.e.submittedAt.getTime(),
    );
    return {
      userId: t.e.userId,
      total: t.total,
      place: (first === -1 ? i : first) + 1,
    };
  });
}

// The rubric counts only if every player who passed the baseline was judged.
export const rubricIncluded = (entries: Entry[]) =>
  entries.every((e) => !e.baselinePassed || e.rubric !== null);
