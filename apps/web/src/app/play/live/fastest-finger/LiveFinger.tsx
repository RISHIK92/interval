"use client";

import { FINGER, type FingerState } from "../finger-state";
import { LivePlay } from "../LivePlay";
import { FingerView } from "./FingerView";

const current = (state: FingerState) =>
  state.phase === "round" ? state.n : null;

// P3-W16-S05 (Q-P3-24): live fastest finger.
export function LiveFinger() {
  return (
    <LivePlay
      mode="fastest_finger"
      game={FINGER}
      current={current}
      View={FingerView}
    />
  );
}
