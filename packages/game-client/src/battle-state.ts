import { z } from "zod";
import type { LiveGame } from "./live-client";

// P5-W31-S03 (§6.5; Q-P5-15, Q-P5-16): the battle screen's state, from the game server's
// messages (services/game/battle_actor.go), checked here at the socket boundary. The
// extension arrives only with the reveal; a Run's tests are the visible ones, and a
// Submit's results are counts per layer (LLDQ-4). Times are the server's seconds left,
// counted down on this clock (`endsAt`).

const Bests = z.record(z.string(), z.number().int().min(0));
// Q-WD-14: each player's best as tests passed out of the live total: counts, never which
// tests (LLDQ-4). Absent from a server older than it.
const Progress = z.record(
  z.string(),
  z.object({
    passed: z.number().int().min(0),
    total: z.number().int().min(0),
    // Q-WD-17 (owner, 2026-11-24): the hint levels the player has opened, public;
    // never their text.
    hints: z.array(z.number().int().min(1).max(3)).optional(),
  }),
);
// A problem with no extension still has its reveal at 30:00, with no text: the clock's.
const Extension = z.object({
  type: z.literal("extension"),
  seconds: z.number().min(0),
  statement: z.string().optional(),
  starters: z.record(z.string(), z.string()).optional(),
});
// Q-WD-17: hints that cost points. What each level costs (0 in practice), the texts this
// player has opened (each only once asked for), and what they've cost so far.
const HintLevel = z.number().int().min(1).max(3);
const OpenedHint = z.object({ level: HintLevel, text: z.string() });
const Hints = z.object({
  costs: z.tuple([
    z.number().int().min(0),
    z.number().int().min(0),
    z.number().int().min(0),
  ]),
  opened: z.array(OpenedHint),
  spent: z.number().int().min(0),
});
// Q-WD-17 (LLDQ-4): a visible test's name, and when it failed why and the line of the
// player's code it surfaced at, when the judge knows. Never a hidden test's.
const Failure = z.object({
  name: z.string().min(1).max(64),
  message: z.string().min(1).max(200).optional(),
  line: z.number().int().min(1).max(1_000_000).optional(),
});
const Test = Failure.partial({ name: true }).extend({
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
    progress: Progress.optional(),
    hints: Hints.optional(),
    extension: Extension.optional(),
    // ADR-0048: a practice session: `seconds` is its cap, not a clock to show.
    practice: z.boolean().optional(),
  }),
  Extension,
  z.object({ type: z.literal("ran"), tests: z.array(Test) }),
  z.object({
    type: z.literal("submitted"),
    points: z.number().int().min(0),
    layers: z.record(z.string(), Layer),
    best: z.number().int().min(0),
    failures: z.array(Failure).optional(),
  }),
  z.object({
    type: z.literal("refused"),
    code: z.string(),
    reason: z.string(),
    submit: z.boolean(),
  }),
  z.object({ type: z.literal("judge_error"), submit: z.boolean() }),
  z.object({
    type: z.literal("hint"),
    level: HintLevel,
    text: z.string(),
    spent: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("best"),
    best: Bests,
    progress: Progress.optional(),
  }),
  z.object({
    type: z.literal("final"),
    totals: Bests,
    winner: z.string(),
    abandoned: z.array(z.string()).optional(),
    // P5-W32: each player's place (1 the best), as the game server ranks a room.
    places: z.record(z.string(), z.number().int().min(1)).optional(),
  }),
  z.object({ type: z.literal("cancelled") }),
]);
type BattleMessage = z.infer<typeof Message>;
type BattleTest = z.infer<typeof Test>;
export type BattleFailure = z.infer<typeof Failure>;
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
  // ADR-0048: LLD practice: one player, no clock shown, the extension on request.
  practice: boolean;
  extension: { statement: string; starters: Record<string, string> } | null;
  best: Record<string, number>;
  progress: z.infer<typeof Progress>;
  // Null: this battle offers no hints.
  hints: z.infer<typeof Hints> | null;
  ran: BattleTest[] | null;
  submitted: {
    points: number;
    layers: Record<string, BattleLayer>;
    failures: BattleFailure[];
  } | null;
  // Q-WD-17: the failing-test box: the latest answer's first failing visible test.
  failing: BattleFailure | null;
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
      places: Record<string, number>;
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
        practice: message.practice === true,
        extension: extensionOf(message.extension),
        best: message.best,
        progress: message.progress ?? {},
        hints: message.hints ?? null,
        ran: playing?.ran ?? null,
        submitted: playing?.submitted ?? null,
        failing: playing?.failing ?? null,
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
    case "ran": {
      if (playing === null) return state;
      const failed = message.tests.find(
        (t) => !t.passed && t.name !== undefined,
      );
      return {
        ...playing,
        ...answered(false),
        ran: message.tests,
        failing:
          failed?.name === undefined
            ? null
            : { name: failed.name, message: failed.message, line: failed.line },
      };
    }
    case "submitted": {
      if (playing === null) return state;
      const failures = message.failures ?? [];
      return {
        ...playing,
        ...answered(true),
        submitted: {
          points: message.points,
          layers: message.layers,
          failures,
        },
        failing: failures[0] ?? null,
      };
    }
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
    case "hint": {
      if (playing?.hints == null) return state;
      const { opened } = playing.hints;
      return {
        ...playing,
        hints: {
          ...playing.hints,
          opened: opened.some((h) => h.level === message.level)
            ? opened
            : [...opened, { level: message.level, text: message.text }],
          spent: message.spent,
        },
      };
    }
    case "best":
      return playing === null
        ? state
        : {
            ...playing,
            best: message.best,
            progress: message.progress ?? playing.progress,
          };
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
        places: message.places ?? {},
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
