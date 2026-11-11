import { expect, test } from "vitest";
import type { FileStore } from "../../../server/ports";
import { loadTimeline } from "./scene";

// P4.5-W26-S02 (AI-1, Q-P4.5-03): a drafted timeline as the owner sees it and as the
// approval checks it: the file from the media bucket, every rule the worker's schema
// can't say (ids exist, anchors in order and within the captions, no overlaps).
const good = {
  diagram: {
    title: "Leader election",
    shapes: [
      { id: "a", kind: "service", label: "Node A", at: { col: 0, row: 0 } },
      { id: "b", kind: "service", label: "Node B", at: { col: 5, row: 0 } },
    ],
    arrows: [{ from: "a", to: "b", label: "vote" }],
  },
  steps: [
    { at: 0, show: ["a", "b"], describe: "Two nodes." },
    { at: 1, show: ["a->b"], describe: "A asks B for a vote." },
  ],
};

function bucket(files: Record<string, string>): FileStore {
  return {
    put: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    get: (key) => {
      const text = files[key];
      return Promise.resolve(
        text === undefined
          ? null
          : { body: new Blob([text]).stream(), etag: null, size: null },
      );
    },
  };
}

test("a valid timeline loads", async () => {
  const got = await loadTimeline(bucket({ k: JSON.stringify(good) }), "k", 2);
  expect("timeline" in got && got.timeline.steps.length).toBe(2);
});

test("missing, not JSON, a broken rule, or an anchor past the captions: problems", async () => {
  const problems = async (text: string | undefined, words = 2) => {
    const got = await loadTimeline(
      bucket(text === undefined ? {} : { k: text }),
      "k",
      words,
    );
    return "problems" in got ? got.problems : [];
  };
  expect(await problems(undefined)).toEqual([
    "The timeline's file isn't in the media bucket.",
  ]);
  expect((await problems("{nope"))[0]).toMatch(/^Not JSON/);
  const unknown = {
    ...good,
    steps: [{ at: 0, show: ["z"], describe: "x" }],
  };
  expect(await problems(JSON.stringify(unknown))).not.toEqual([]);
  expect(await problems(JSON.stringify(good), 1)).toEqual([
    "A step is anchored past the explainer's last caption word.",
  ]);
});
