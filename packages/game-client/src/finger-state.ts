import { z } from "zod";
import type { LiveGame } from "./live-client";

// P3-W16-S05 (§6.3, Q-P3-24): the fastest finger screen's state, from the game server's
// messages (services/game/match.go), checked here at the socket boundary.

const Totals = z.record(z.string(), z.number().int().min(0));

const Message = z.discriminatedUnion("type", [
  z.object({ type: z.literal("joined"), you: z.string() }),
  z.object({ type: z.literal("countdown"), seconds: z.number().min(0) }),
  z.object({
    type: z.literal("round"),
    n: z.number().int().min(1),
    stem: z.string(),
    options: z.array(z.string()),
    // ADR-0037: model-drafted; absent from a server older than the flag.
    ai: z.boolean().default(false),
    seconds: z.number().min(0),
  }),
  z.object({ type: z.literal("locked"), player: z.string() }),
  z.object({
    type: z.literal("reveal"),
    n: z.number().int().min(1),
    stem: z.string(),
    options: z.array(z.string()),
    ai: z.boolean().default(false),
    correct: z.number().int().min(0),
    taken: z.string(), // "": nobody
    totals: Totals,
  }),
  z.object({
    type: z.literal("resume"),
    n: z.number().int().min(0),
    totals: Totals,
    answered: z.boolean().optional(),
    locked: z.array(z.string()).optional(), // mid-round: who has answered
  }),
  z.object({
    type: z.literal("final"),
    totals: Totals,
    winner: z.string(),
    abandoned: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("cancelled") }),
]);

type Base = { you: string | null; totals: Record<string, number> };
export type FingerState =
  | (Base & { phase: "connecting" })
  | (Base & { phase: "countdown"; endsAt: number })
  // Back after a drop, before the next round or reveal arrives.
  | (Base & { phase: "waiting"; locked: { n: number; players: string[] } })
  | (Base & {
      phase: "round";
      n: number;
      stem: string;
      options: string[];
      ai: boolean;
      endsAt: number;
      locked: { n: number; players: string[] };
    })
  | (Base & {
      phase: "reveal";
      n: number;
      stem: string;
      options: string[];
      ai: boolean;
      correct: number;
      taken: string;
    })
  | {
      phase: "final";
      you: string | null;
      outcome: "won" | "lost" | "draw";
      totals: Record<string, number>;
      abandoned: string[];
    }
  | { phase: "cancelled" };

const START: FingerState = { phase: "connecting", you: null, totals: {} };

function step(
  state: FingerState,
  message: z.infer<typeof Message>,
  now: number,
): FingerState {
  if (state.phase === "cancelled" || state.phase === "final") return state;
  const base: Base = { you: state.you, totals: state.totals };
  // A rejoin is told whether it had answered the round in play (resume, then round).
  const locked =
    state.phase === "round" || state.phase === "waiting"
      ? state.locked
      : { n: 0, players: [] as string[] };
  switch (message.type) {
    case "joined":
      return { ...state, you: message.you };
    case "countdown":
      return {
        ...base,
        phase: "countdown",
        endsAt: now + message.seconds * 1000,
      };
    case "round":
      return {
        ...base,
        phase: "round",
        n: message.n,
        stem: message.stem,
        options: message.options,
        ai: message.ai,
        endsAt: now + message.seconds * 1000,
        locked: locked.n === message.n ? locked : { n: message.n, players: [] },
      };
    case "locked":
      return state.phase === "round" &&
        !state.locked.players.includes(message.player)
        ? {
            ...state,
            locked: {
              n: state.n,
              players: [...state.locked.players, message.player],
            },
          }
        : state;
    case "reveal":
      // From any phase: a player back during the pause is shown it too.
      return {
        ...base,
        phase: "reveal",
        totals: message.totals,
        n: message.n,
        stem: message.stem,
        options: message.options,
        ai: message.ai,
        correct: message.correct,
        taken: message.taken,
      };
    case "resume": {
      const players = message.locked ?? [];
      return {
        ...base,
        phase: "waiting",
        totals: message.totals,
        locked: { n: message.n, players },
      };
    }
    case "final":
      return {
        phase: "final",
        you: state.you,
        outcome:
          message.winner === ""
            ? "draw"
            : message.winner === state.you
              ? "won"
              : "lost",
        totals: message.totals,
        abandoned: message.abandoned ?? [],
      };
    case "cancelled":
      return { phase: "cancelled" };
  }
}

// Fastest finger for runLive.
export const FINGER: LiveGame<FingerState> = {
  start: START,
  step: (state, raw, now) => {
    const parsed = Message.safeParse(raw);
    return parsed.success ? step(state, parsed.data, now) : null;
  },
  over: (state) => state.phase === "final" || state.phase === "cancelled",
};
