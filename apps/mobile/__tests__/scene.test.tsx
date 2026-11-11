import { act, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { Scene } from "../components/Scene";

// P4.5-W27-S02 (TTS-5, §5G, Q-P4.5-04): the approved timeline in the app's full player,
// stepping with the narration; each step said for screen readers; labeled AI; no
// animation (what reduced motion asks for).
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
// A word every half second.
const captions = ["Raft", "has", "a", "leader."].map((text, i) => ({
  text,
  start: i / 2,
  end: i / 2 + 0.5,
}));
const A = "https://interval.test/media/explainers/3/7/scenes/a.json";
const B = "https://interval.test/media/explainers/3/8/scenes/b.json";

let announce: jest.SpyInstance;
let error: jest.SpyInstance;
beforeEach(() => {
  announce = jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  error = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

function serve(files: Record<string, unknown>) {
  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation((url) =>
      Promise.resolve(
        typeof url === "string" && url in files
          ? Response.json(files[url])
          : new Response(null, { status: 404 }),
      ),
    );
}
const drawn = () => JSON.stringify(screen.toJSON());

test("each step draws, is said for screen readers once, and is labeled AI", async () => {
  serve({ [A]: raw });
  const view = await render(<Scene url={A} captions={captions} time={0.2} />);
  await act(() => Promise.resolve());
  // Before the first step: nothing drawn, nothing said.
  expect(drawn()).not.toContain("Node A");
  expect(announce).not.toHaveBeenCalled();
  await view.rerender(<Scene url={A} captions={captions} time={0.6} />);
  expect(drawn()).toContain("Node A");
  expect(drawn()).not.toContain("Node B");
  // Said to screen readers, not shown: Q-P4.5-04.
  expect(
    screen.getByLabelText("Leader election. One node waits. AI-drawn."),
  ).toBeOnTheScreen();
  expect(screen.queryByText("One node waits.")).toBeNull();
  expect(screen.getByText("AI")).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledWith("One node waits.");
  // Time moves within the step: said once.
  await view.rerender(<Scene url={A} captions={captions} time={0.9} />);
  expect(announce).toHaveBeenCalledTimes(1);
  await view.rerender(<Scene url={A} captions={captions} time={1.6} />);
  expect(drawn()).toContain("Node B");
  expect(announce).toHaveBeenLastCalledWith("A second node joins.");
});

test("a file that fails draws nothing and is logged; another explainer's never shows", async () => {
  serve({ [A]: raw });
  const view = await render(<Scene url={A} captions={captions} time={0.6} />);
  await act(() => Promise.resolve());
  expect(drawn()).toContain("Node A");
  // B isn't there: A's drawing must not stay under B's narration.
  await view.rerender(<Scene url={B} captions={captions} time={0.6} />);
  expect(drawn()).not.toContain("Node A");
  await act(() => Promise.resolve());
  expect(drawn()).not.toContain("Node A");
  expect(error).toHaveBeenCalledWith(`scene: ${B} answered 404`);
});

test("the next explainer's first step is announced in turn", async () => {
  serve({
    [A]: raw,
    [B]: { ...raw, steps: [{ ...raw.steps[0], describe: "B begins." }] },
  });
  const view = await render(<Scene url={A} captions={captions} time={0.6} />);
  await act(() => Promise.resolve());
  await view.rerender(<Scene url={B} captions={captions} time={0.6} />);
  await act(() => Promise.resolve());
  expect(announce).toHaveBeenLastCalledWith("B begins.");
});

test("offline: nothing drawn, logged", async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
  await render(<Scene url={A} captions={captions} time={0.6} />);
  await act(() => Promise.resolve());
  expect(drawn()).not.toContain("Node A");
  expect(error).toHaveBeenCalledWith(
    `scene: ${A} couldn't be fetched`,
    expect.any(TypeError),
  );
});
