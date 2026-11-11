import { afterEach, expect, test, vi } from "vitest";
import { fetchTimeline, sceneAt } from "./scene";
import { Timeline } from "./timeline";

// P4.5-W27-S01/S02 (TTS-5, Q-P4.5-04): what both players do with an approved timeline:
// fetch it and hold it to its rules, then find the step the narration has reached.
const raw = {
  diagram: {
    title: "Leader election",
    shapes: [
      { id: "a", kind: "service", label: "Node A", at: { col: 0, row: 0 } },
    ],
    arrows: [],
  },
  steps: [{ at: 1, show: ["a"], describe: "One node waits." }],
};
const timeline = Timeline.parse(raw);
const captions = [{ start: 0 }, { start: 0.5 }];

afterEach(() => {
  vi.restoreAllMocks();
});

test("the file is fetched and held to the timeline's rules; a failure is null, logged", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const answer = (body: string, status = 200) =>
    vi.fn(() => Promise.resolve(new Response(body, { status })));
  expect(
    await fetchTimeline("/media/a.json", answer(JSON.stringify(raw))),
  ).toEqual(timeline);
  expect(await fetchTimeline("/media/a.json", answer("{}", 404))).toBeNull();
  expect(await fetchTimeline("/media/a.json", answer("{nope"))).toBeNull();
  expect(
    await fetchTimeline(
      "/media/a.json",
      answer(JSON.stringify({ ...raw, steps: [] })),
    ),
  ).toBeNull();
  expect(error).toHaveBeenCalledTimes(3);
});

test("the step the narration has reached, and what it draws", () => {
  expect(sceneAt(null, captions, 5)).toEqual({ step: -1, state: null });
  expect(sceneAt(timeline, captions, 0.2)).toEqual({ step: -1, state: null });
  const reached = sceneAt(timeline, captions, 0.6);
  expect(reached.step).toBe(0);
  expect(reached.state?.describe).toBe("One node waits.");
  expect(reached.state?.hidden).toEqual([]);
});
