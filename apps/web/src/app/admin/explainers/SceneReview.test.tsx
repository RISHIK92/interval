import { Timeline } from "@interval/diagrams";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { SceneStep } from "./SceneReview";

// P4.5-W26-S02 (AI-1, Q-P4.5-03): the owner steps through a drafted timeline: each step's
// drawing, its description, and the caption word it starts on.
const timeline = Timeline.parse({
  diagram: {
    title: "Leader election",
    shapes: [
      { id: "a", kind: "service", label: "Node A", at: { col: 0, row: 0 } },
      { id: "b", kind: "service", label: "Node B", at: { col: 5, row: 0 } },
    ],
    arrows: [{ from: "a", to: "b", label: "vote" }],
  },
  steps: [
    { at: 0, show: ["a"], describe: "One node." },
    { at: 2, show: ["b", "a->b"], describe: "A asks B for a vote." },
  ],
});
const captions = ["Raft", "elects", "a", "leader."].map((text, i) => ({
  text,
  start: i / 2,
  end: i / 2 + 0.5,
}));
const at = (step: number) =>
  renderToStaticMarkup(
    <SceneStep
      timeline={timeline}
      captions={captions}
      step={step}
      onStep={vi.fn()}
    />,
  );

test("each step draws, describes itself, and marks the word it starts on", () => {
  const first = at(0);
  expect(first).toContain("One node.");
  expect(first).toContain("Step 1 of 2");
  expect(first).toContain('type="range"');
  expect(first).toContain("<mark>Raft</mark>");
  expect(first).toContain("Node A");
  expect(first).not.toContain("Node B");
  const second = at(1);
  expect(second).toContain("A asks B for a vote.");
  expect(second).toContain("<mark>a</mark>");
  expect(second).not.toContain("<mark>Raft</mark>");
  expect(second).toContain("Node B");
});

// The range input in a rendered tree (no DOM here), to move the scrubber.
function range(node: ReactNode): { onChange: (e: unknown) => void } | null {
  if (!isValidElement<{ type?: string; children?: ReactNode }>(node))
    return null;
  if (node.type === "input" && node.props.type === "range")
    return node.props as unknown as { onChange: (e: unknown) => void };
  const children = [node.props.children].flat<ReactNode[]>();
  for (const child of children) {
    const found = range(child);
    if (found !== null) return found;
  }
  return null;
}

test("moving the scrubber asks for that step, as a number", () => {
  const onStep = vi.fn();
  const tree = SceneStep({ timeline, captions, step: 0, onStep });
  range(tree)?.onChange({ target: { value: "1" } });
  expect(onStep).toHaveBeenCalledWith(1);
  expect(at(0)).toContain('aria-valuetext="Step 1 of 2"');
});
