"use client";

import { LivePlay } from "../LivePlay";
import { SPRINT, type SprintState } from "@interval/game-client";
import { SprintView } from "./SprintView";

const current = (state: SprintState) =>
  state.phase === "playing" ? (state.question?.n ?? null) : null;

// P3-W16-S04 (Q-P3-23): the live 1v1 sprint.
export function LiveSprint({ matchId }: { matchId?: string | undefined }) {
  return (
    <LivePlay
      mode="sprint"
      game={SPRINT}
      current={current}
      matchId={matchId}
      View={SprintView}
    />
  );
}
