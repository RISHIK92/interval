"use client";

import type { Caption } from "@interval/api-client";
import { describeDiagram, stateAt, type Timeline } from "@interval/diagrams";
import { useState } from "react";
import { DiagramSvg } from "../../diagrams/DiagramSvg";

// P4.5-W26-S02 (AI-1, Q-P4.5-03): the owner steps through a drafted timeline with a
// scrubber: each step's drawing, its description (what screen readers will hear), and
// the narration with the word it starts on marked. By step, not by time: playing it
// with the audio is the players' (W27).
type Props = { timeline: Timeline; captions: Caption[] };

export function SceneStep({
  timeline,
  captions,
  step,
  onStep,
}: Props & { step: number; onStep: (step: number) => void }) {
  const state = stateAt(timeline, step);
  const word = timeline.steps[step]?.at;
  const count = timeline.steps.length;
  return (
    <div className="flex flex-col gap-3">
      <DiagramSvg
        description={describeDiagram(state.diagram, {
          hidden: state.hidden,
          highlight: state.highlight,
        })}
      />
      <label className="flex flex-col gap-1">
        <span>
          Step {step + 1} of {count}
        </span>
        <input
          type="range"
          min={0}
          max={count - 1}
          value={step}
          aria-valuetext={`Step ${String(step + 1)} of ${String(count)}`}
          onChange={(e) => {
            onStep(Number(e.target.value));
          }}
        />
      </label>
      <p aria-live="polite">{state.describe}</p>
      <p className="text-ink-muted">
        {captions.map((c, i) => (
          <span key={i}>{i === word ? <mark>{c.text}</mark> : c.text} </span>
        ))}
      </p>
    </div>
  );
}

export function SceneReview(props: Props) {
  const [step, setStep] = useState(0);
  return <SceneStep {...props} step={step} onStep={setStep} />;
}
