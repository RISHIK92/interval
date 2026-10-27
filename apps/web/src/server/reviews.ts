import { createEmptyCard, fsrs, Rating, State } from "ts-fsrs";

// FSRS review cards (PER-2, Q-P2-16, P2-W9-S04): one per user and concept, rated once
// per quiz (all its answers right: Good; any wrong: Again). Default weights and 90%
// retention (owner). Short-term steps off (suggested default, 2026-10-28): a concept
// comes back in days, not ten minutes after the quiz that rated it.
const scheduler = fsrs({ request_retention: 0.9, enable_short_term: false });

export type ReviewCard = {
  due: Date;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: State;
  lastReview: Date;
};

// The database keeps ts-fsrs's state as a smallint (0-3, checked there).
const STATES = [State.New, State.Learning, State.Review, State.Relearning];
export function fsrsState(stored: number): State {
  const state = STATES[stored];
  if (state === undefined)
    throw new Error(`unknown FSRS state ${String(stored)}`);
  return state;
}

export function rate(
  card: ReviewCard | null,
  right: boolean,
  now: Date,
): ReviewCard {
  const from =
    card === null
      ? createEmptyCard(now)
      : {
          due: card.due,
          stability: card.stability,
          difficulty: card.difficulty,
          // Deprecated in ts-fsrs 5 (it works from last_review); the type still asks.
          elapsed_days: 0,
          scheduled_days: card.scheduledDays,
          learning_steps: card.learningSteps,
          reps: card.reps,
          lapses: card.lapses,
          state: card.state,
          last_review: card.lastReview,
        };
  const { card: next } = scheduler.next(
    from,
    now,
    right ? Rating.Good : Rating.Again,
  );
  return {
    due: next.due,
    stability: next.stability,
    difficulty: next.difficulty,
    scheduledDays: next.scheduled_days,
    learningSteps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    lastReview: now,
  };
}
