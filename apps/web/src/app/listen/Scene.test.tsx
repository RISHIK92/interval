import { Timeline } from "@interval/diagrams";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SceneView, timelineFor } from "./Scene";

// P4.5-W27-S01 (TTS-5, §5G, Q-P4.5-04): the approved timeline drawn in the full player,
// stepping with the narration; each step said for screen readers; labeled AI. Fetching
// and the clock are packages/diagrams' (scene.test.ts there).
const raw = {
  diagram: {
    title: "Leader election",
    shapes: [
      { id: "a", kind: "service", label: "Node A", at: { col: 0, row: 0 } },
      { id: "b", kind: "service", label: "Node B", at: { col: 5, row: 0 } },
    ],
    arrows: [],
  },
  steps: [
    { at: 1, show: ["a"], describe: "One node waits." },
    { at: 3, show: ["b"], describe: "A second node joins." },
  ],
};
const timeline = Timeline.parse(raw);
// A word every half second.
const captions = ["Raft", "has", "a", "leader."].map((text, i) => ({
  text,
  start: i / 2,
  end: i / 2 + 0.5,
}));
const at = (time: number) =>
  renderToStaticMarkup(
    <SceneView timeline={timeline} captions={captions} time={time} />,
  );

const live = '<p aria-live="polite" class="sr-only">';

test("before the first step nothing is drawn; the live region waits, empty", () => {
  expect(at(0.2)).toBe(`${live}</p>`);
  expect(
    renderToStaticMarkup(
      <SceneView timeline={null} captions={captions} time={3} />,
    ),
  ).toBe(`${live}</p>`);
});

test("each step draws what it shows and says it for screen readers, labeled AI", () => {
  const first = at(0.6);
  expect(first).toContain("Node A");
  expect(first).not.toContain("Node B");
  expect(first).toContain(`${live}One node waits.</p>`);
  // The AI box's tag (AI-1).
  expect(first).toContain(">AI</span>");
  // Animated only for those who haven't asked for less motion.
  expect(first).toContain("motion-safe:");
  const second = at(1.6);
  expect(second).toContain("Node B");
  expect(second).toContain("A second node joins.");
});

test("only the timeline fetched for this explainer is drawn", () => {
  const loaded = { url: "/media/a.json", timeline };
  expect(timelineFor(loaded, "/media/a.json")).toBe(timeline);
  // The next explainer's file is still loading: not the last one's drawing.
  expect(timelineFor(loaded, "/media/b.json")).toBeNull();
  expect(timelineFor(null, "/media/a.json")).toBeNull();
});
