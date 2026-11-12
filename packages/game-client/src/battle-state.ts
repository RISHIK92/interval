import { z } from "zod";
import type { LiveGame } from "./live-client";

// P5-W31-S03 (§6.5; Q-P5-15, Q-P5-16): the battle screen's state, from the game server's
// messages (services/game/battle_actor.go), checked here at the socket boundary. The
// extension arrives only with the reveal; a Run's tests are the visible ones, and a
// Submit's results are counts per layer (LLDQ-4). Times are the server's seconds left,
// counted down on this clock (`endsAt`).

const Bests = z.record(z.string(), z.number().int().min(0));
// A problem with no extension still has its reveal at 30:00, with no text: the clock's.
const Extension = z.object({
  type: z.literal("extension"),
  seconds: z.number().min(0),
  statement: z.string().optional(),
  starters: z.record(z.string(), z.string()).optional(),
});
const Test = z.object({
  passed: z.boolean(),
  verdict: z.string().optional(),
  call: z.number().int().min(0).optional(),
  reason: z.string().optional(),
});
const Layer = z.object({
  passed: z.number().int().min(0),
  total: z.number().int().min(0),
});

const Message = z.discriminatedUnion("type", [
  z.object({ type: z.literal("joined"), you: z.string() }),
  z.object({
    type: z.literal("battle"),
    seconds: z.number().min(0),
    revealed: z.boolean(),
    best: Bests,
    extension: Extension.optional(),
  }),
  Extension,
  z.object({ type: z.literal("ran"), tests: z.array(Test) }),
  z.object({
    type: z.literal("submitted"),
    points: z.number().int().min(0),
    layers: z.record(z.string(), Layer),
    best: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("refused"),
    code: z.string(),
    reason: z.string(),
    submit: z.boolean(),
  }),
  z.object({ type: z.literal("judge_error"), submit: z.boolean() }),
  z.object({ type: z.literal("best"), best: Bests }),
  z.object({
    type: z.literal("final"),
    totals: Bests,
    winner: z.string(),
    abandoned: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("cancelled") }),
]);
type BattleMessage = z.infer<typeof Message>;
type BattleTest = z.infer<typeof Test>;
type BattleLayer = z.infer<typeof Layer>;

function extensionOf(
  message: z.infer<typeof Extension> | undefined,
): BattlePlaying["extension"] {
  return message?.statement === undefined || message.starters === undefined
    ? null
    : { statement: message.statement, starters: message.starters };
}

export type BattlePlaying = {
  phase: "playing";
  you: string | null;
  endsAt: number;
  extension: { statement: string; starters: Record<string, string> } | null;
  best: Record<string, number>;
  ran: BattleTest[] | null;
  submitted: { points: number; layers: Record<string, BattleLayer> } | null;
  // A Run or Submit sent and not yet answered: its button waits.
  running: boolean;
  submitting: boolean;
  // The last refusal or judge failure, for the player.
  notice: string | null;
};

export type BattleState =
  | { phase: "connecting"; you: string | null }
  | BattlePlaying
  | {
      phase: "final";
      you: string | null;
      outcome: "won" | "lost" | "draw";
      totals: Record<string, number>;
      abandoned: string[];
    }
  | { phase: "cancelled" };

export const BATTLE_START: BattleState = { phase: "connecting", you: null };

// The player sent code: its button waits for the answer.
export function battleSent(state: BattleState, submit: boolean): BattleState {
  if (state.phase !== "playing") return state;
  return submit
    ? { ...state, submitting: true, notice: null }
    : { ...state, running: true, notice: null };
}

function battleStep(
  state: BattleState,
  message: BattleMessage,
  now: number,
): BattleState {
  if (state.phase === "cancelled" || state.phase === "final") return state;
  const you = state.you;
  const playing = state.phase === "playing" ? state : null;
  const answered = (submit: boolean) =>
    submit ? { submitting: false } : { running: false };
  switch (message.type) {
    case "joined":
      return { ...state, you: message.you };
    case "battle":
      return {
        phase: "playing",
        you,
        endsAt: now + message.seconds * 1000,
        extension: extensionOf(message.extension),
        best: message.best,
        ran: playing?.ran ?? null,
        submitted: playing?.submitted ?? null,
        running: false,
        submitting: false,
        notice: null,
      };
    case "extension":
      return playing === null
        ? state
        : {
            ...playing,
            endsAt: now + message.seconds * 1000,
            extension: extensionOf(message),
          };
    case "ran":
      return playing === null
        ? state
        : { ...playing, ...answered(false), ran: message.tests };
    case "submitted":
      return playing === null
        ? state
        : {
            ...playing,
            ...answered(true),
            submitted: { points: message.points, layers: message.layers },
          };
    case "refused":
      return playing === null
        ? state
        : { ...playing, ...answered(message.submit), notice: message.reason };
    case "judge_error":
      return playing === null
        ? state
        : {
            ...playing,
            ...answered(message.submit),
            notice: "The judge couldn't run that; try again.",
          };
    case "best":
      return playing === null ? state : { ...playing, best: message.best };
    case "final":
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
      };
    case "cancelled":
      return { phase: "cancelled" };
  }
}

// The battle for runLive.
export const BATTLE: LiveGame<BattleState> = {
  start: BATTLE_START,
  step: (state, raw, now) => {
    const parsed = Message.safeParse(raw);
    return parsed.success ? battleStep(state, parsed.data, now) : null;
  },
  over: (state) => state.phase === "final" || state.phase === "cancelled",
};
