import { describe, expect, test, vi } from "vitest";
import { saveBoundaries, saveTags } from "./admin-review";
import type { AdminReview, JobQueue, ReviewItem } from "./ports";

// ING-6, P1-W3-S05: the admin's edits are checked against the item before they are kept.
const item: ReviewItem = {
  id: "7",
  title: "WAL",
  url: "https://blog.example.test/wal",
  sourceName: "Blog",
  sections: [
    { heading: null, level: null, wordCount: 80 },
    { heading: "Setup", level: 2, wordCount: 400 },
    { heading: "Recovery", level: 2, wordCount: 900 },
  ],
  moments: [
    {
      ordinal: 0,
      title: "WAL",
      heading: null,
      estimatedMinutes: 1,
      oversized: false,
    },
    {
      ordinal: 1,
      title: "Setup",
      heading: "Setup",
      estimatedMinutes: 6,
      oversized: false,
    },
  ],
  modelTags: { item: null, moments: new Map() },
  boundaries: null,
  tagOverrides: new Map(),
};

function fakes() {
  const review = {
    recent: vi.fn(),
    item: vi.fn((id: string) => Promise.resolve(id === "7" ? item : null)),
    activeConcepts: vi.fn(() =>
      Promise.resolve(["write-ahead-log", "transactions"]),
    ),
    setBoundaries: vi.fn(() => Promise.resolve()),
    setTags: vi.fn(() => Promise.resolve()),
  } satisfies AdminReview;
  const queue = { enqueue: vi.fn(() => Promise.resolve()) } satisfies JobQueue;
  return { review, queue };
}

describe("boundaries", () => {
  test("are kept and the item is segmented again", async () => {
    const { review, queue } = fakes();
    const result = await saveBoundaries(review, queue, "admin-1", "7", [
      "Recovery",
    ]);
    expect(result).toEqual({ ok: true });
    expect(review.setBoundaries).toHaveBeenCalledWith(
      "7",
      ["Recovery"],
      "admin-1",
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      "segment_item",
      { content_item_id: 7 },
      expect.anything(),
    );
    const [, , options] = queue.enqueue.mock.calls[0] as unknown as [
      string,
      unknown,
      { idempotencyKey: string },
    ];
    expect(options.idempotencyKey).toMatch(/^review-segment-7-\d+$/);
  });

  test("none chosen clears the override", async () => {
    const { review, queue } = fakes();
    await saveBoundaries(review, queue, "admin-1", "7", []);
    expect(review.setBoundaries).toHaveBeenCalledWith("7", null, "admin-1");
  });

  test("a heading the item doesn't have is refused", async () => {
    const { review, queue } = fakes();
    const result = await saveBoundaries(review, queue, "admin-1", "7", [
      "Nope",
    ]);
    expect(result.ok).toBe(false);
    expect(review.setBoundaries).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  test("an unknown item is refused", async () => {
    const { review, queue } = fakes();
    expect((await saveBoundaries(review, queue, "a", "99", [])).ok).toBe(false);
  });
});

describe("tags", () => {
  test("are kept for the item or a moment's heading", async () => {
    const { review } = fakes();
    const tags = { difficulty: "advanced", concepts: ["transactions"] };
    expect(await saveTags(review, "admin-1", "7", "", tags)).toEqual({
      ok: true,
    });
    expect(await saveTags(review, "admin-1", "7", "Setup", tags)).toEqual({
      ok: true,
    });
    expect(review.setTags).toHaveBeenCalledWith("7", "Setup", tags, "admin-1");
  });

  test("null clears the override", async () => {
    const { review } = fakes();
    await saveTags(review, "admin-1", "7", "Setup", null);
    expect(review.setTags).toHaveBeenCalledWith("7", "Setup", null, "admin-1");
  });

  test.each([
    ["an unknown concept", { difficulty: "advanced", concepts: ["made-up"] }],
    ["an unknown level", { difficulty: "expert", concepts: [] }],
    [
      "more than five concepts",
      { difficulty: "advanced", concepts: ["a", "b", "c", "d", "e", "f"] },
    ],
  ])("%s is refused", async (_case, tags) => {
    const { review } = fakes();
    expect((await saveTags(review, "a", "7", "", tags)).ok).toBe(false);
    expect(review.setTags).not.toHaveBeenCalled();
  });

  test("a repeated concept counts once", async () => {
    const { review } = fakes();
    const repeated = Array<string>(6).fill("transactions");
    const tags = { difficulty: "advanced", concepts: repeated };
    expect(await saveTags(review, "a", "7", "", tags)).toEqual({ ok: true });
    expect(review.setTags).toHaveBeenCalledWith(
      "7",
      "",
      { difficulty: "advanced", concepts: ["transactions"] },
      "a",
    );
  });

  test("an override can be cleared for a heading that no longer starts a moment", async () => {
    const { review } = fakes();
    expect(await saveTags(review, "a", "7", "Recovery", null)).toEqual({
      ok: true,
    });
  });

  test("a heading that isn't one of the item's moments is refused", async () => {
    const { review } = fakes();
    const tags = { difficulty: "beginner", concepts: [] };
    expect((await saveTags(review, "a", "7", "Recovery", tags)).ok).toBe(false);
  });
});
