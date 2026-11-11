import { Timeline } from "@interval/diagrams";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { fetchTimeline, SceneView, timelineFor } from "./Scene";

// P4.5-W27-S01 (TTS-5, §5G, Q-P4.5-04): the approved timeline drawn in the full player,
// stepping with the narration; each step said for screen readers; labeled AI.
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

test("the file is fetched and held to the timeline's rules; a failure draws nothing, logged", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const ok = (body: unknown, status = 200) =>
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status })),
    );
  expect(await fetchTimeline("/media/a.json", ok(raw))).toEqual(timeline);
  expect(await fetchTimeline("/media/a.json", ok({}, 404))).toBeNull();
  expect(
    await fetchTimeline("/media/a.json", ok({ ...raw, steps: [] })),
  ).toBeNull();
  const notJson = vi.fn(() => Promise.resolve(new Response("{nope")));
  expect(await fetchTimeline("/media/a.json", notJson)).toBeNull();
  expect(error).toHaveBeenCalledTimes(3);
});

test("only the timeline fetched for this explainer is drawn", () => {
  const loaded = { url: "/media/a.json", timeline };
  expect(timelineFor(loaded, "/media/a.json")).toBe(timeline);
  // The next explainer's file is still loading: not the last one's drawing.
  expect(timelineFor(loaded, "/media/b.json")).toBeNull();
  expect(timelineFor(null, "/media/a.json")).toBeNull();
});
