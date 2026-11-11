import { arrowKey } from "./describe";
import type { Diagram } from "./diagram";
import { frames, type Timeline } from "./timeline";

// P4.5-W25-S02 (TTS-5; Q-P4.5-02): the clock both players share. A step begins when
// its caption word does, so the picture keeps time with the narration at any speed.

// The last step whose word has started; -1 before the first. A step whose word isn't
// in the captions never starts: checkAnchors refuses that timeline at approval.
export function stepAt(
  t: Timeline,
  captions: readonly { start: number }[],
  seconds: number,
): number {
  let at = -1;
  t.steps.forEach((step, i) => {
    const word = captions[step.at];
    if (word !== undefined && word.start <= seconds) at = i;
  });
  return at;
}

// What step i draws, ready for describeDiagram. -1 (before the first word, as stepAt
// says) draws nothing; past the last step is a caller's mistake, never a blank picture.
export function stateAt(
  t: Timeline,
  i: number,
): {
  diagram: Diagram;
  hidden: string[];
  highlight: string[];
  describe: string;
} {
  const every = [
    ...t.diagram.shapes.map((s) => s.id),
    ...t.diagram.arrows.map(arrowKey),
  ];
  if (i < 0)
    return { diagram: t.diagram, hidden: every, highlight: [], describe: "" };
  let n = 0;
  for (const frame of frames(t)) {
    if (n === i)
      return {
        diagram: frame.diagram,
        hidden: every.filter((id) => !frame.shown.has(id)),
        highlight: frame.step.highlight ?? [],
        describe: frame.step.describe,
      };
    n += 1;
  }
  throw new RangeError(`step ${String(i)} of ${String(t.steps.length)}`);
}
