import { z } from "zod";
import type { LiveGame } from "./live-client";

// P3-W16-S04 (§6.3, Q-P3-23): the live sprint screen's state, from the game server's
// messages (services/game/sprint.go), checked here at the socket boundary. Times are
// the server's seconds left, counted down on this clock (`endsAt`).

const Scores = z.record(z.string(), z.number().int().min(0));
const Question = z.object({
  n: z.number().int().min(1),
  stem: z.string(),
  options: z.array(z.string()),
});

const Message = z.discriminatedUnion("type", [
  z.object({ type: z.literal("joined"), you: z.string() }),
  z.object({ type: z.literal("countdown"), seconds: z.number().min(0) }),
  z.object({ type: z.literal("start"), seconds: z.number().min(0) }),
  z.object({
    type: z.literal("resume"),
    seconds: z.number().min(0),
    correct: Scores,
  }),
  Question.extend({ type: z.literal("question") }),
  z.object({
    type: z.literal("judged"),
    n: z.number().int().min(1),
    correct: z.boolean(),
  }),
  z.object({ type: z.literal("score"), correct: Scores }),
  z.object({ type: z.literal("done") }),
  z.object({
    type: z.literal("final"),
    totals: Scores,
    winner: z.string(),
    abandoned: z.array(z.string()).optional(),
    review: z
      .object({
        questions: z.array(Question.extend({ correct: z.number().int() })),
        answers: z.record(
          z.string(),
          z.array(
            z.object({
              round: z.number().int().min(1),
              choice: z.number().int().nullable(),
            }),
          ),
        ),
      })
      .optional(),
  }),
  z.object({ type: z.literal("cancelled") }),
]);
export type SprintMessage = z.infer<typeof Message>;

export function parseMessage(raw: unknown): SprintMessage | null {
  const parsed = Message.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

type SprintQuestion = z.infer<typeof Question>;
export type ReviewQuestion = SprintQuestion & {
  correct: number;
  chosen: number | null; // null: reached, not answered
};

export type SprintState =
  | { phase: "connecting"; you: string | null }
  | { phase: "countdown"; you: string | null; endsAt: number }
  | {
      phase: "playing";
      you: string | null;
      endsAt: number;
      question: SprintQuestion | null; // null: every question answered
      last: { n: number; correct: boolean } | null;
      scores: Record<string, number>;
    }
  | {
      phase: "final";
      you: string | null;
      outcome: "won" | "lost" | "draw";
      totals: Record<string, number>;
      abandoned: string[];
      questions: ReviewQuestion[];
    }
  | { phase: "cancelled" };

export const START: SprintState = { phase: "connecting", you: null };

export function sprintStep(
  state: SprintState,
  message: SprintMessage,
  now: number,
): SprintState {
  if (state.phase === "cancelled") return state;
  const you = state.you;
  const playing = state.phase === "playing" ? state : null;
  switch (message.type) {
    case "joined":
      return { ...state, you: message.you };
    case "countdown":
      return { phase: "countdown", you, endsAt: now + message.seconds * 1000 };
    case "start":
    case "resume":
      return {
        phase: "playing",
        you,
        endsAt: now + message.seconds * 1000,
        question: null,
        last: null,
        scores: message.type === "resume" ? message.correct : {},
      };
    case "question":
      return playing === null
        ? state
        : {
            ...playing,
            question: {
              n: message.n,
              stem: message.stem,
              options: message.options,
            },
          };
    case "done":
      return playing === null ? state : { ...playing, question: null };
    case "judged":
      return playing === null
        ? state
        : { ...playing, last: { n: message.n, correct: message.correct } };
    case "score":
      return playing === null ? state : { ...playing, scores: message.correct };
    case "final": {
      const mine = new Map(
        (you === null ? [] : (message.review?.answers[you] ?? [])).map((a) => [
          a.round,
          a.choice,
        ]),
      );
      return {
        phase: "final",
        you,
        outcome:
          message.winner === ""
            ? "draw"
            : message.winner === you
              ? "won"
              : "lost",
        totals: message.totals,
        abandoned: message.abandoned ?? [],
        questions: (message.review?.questions ?? []).map((q) => ({
          ...q,
          chosen: mine.get(q.n) ?? null,
        })),
      };
    }
    case "cancelled":
      return { phase: "cancelled" };
  }
}

// The sprint for runLive.
export const SPRINT: LiveGame<SprintState> = {
  start: START,
  step: (state, raw, now) => {
    const message = parseMessage(raw);
    return message === null ? null : sprintStep(state, message, now);
  },
  over: (state) => state.phase === "final" || state.phase === "cancelled",
};
