import { describe, expect, test, vi } from "vitest";
import { saveTags } from "./admin-review";
import type { AdminReview, ReviewItem } from "./ports";

// ING-6, P1-W3-S05: the admin's edits are checked against the item before they are kept.
// ADR-0058: the whole article's tags only.
const item: ReviewItem = {
  id: "7",
  title: "WAL",
  url: "https://blog.example.test/wal",
  sourceName: "Blog",
  sections: [
    { heading: null, level: null, wordCount: 80 },
    { heading: "Setup", level: 2, wordCount: 400 },
  ],
  modelTags: null,
  tagOverride: null,
};

function fakes() {
  const review = {
    recent: vi.fn(),
    item: vi.fn((id: string) => Promise.resolve(id === "7" ? item : null)),
    activeConcepts: vi.fn(() =>
      Promise.resolve(["write-ahead-log", "transactions"]),
    ),
    setTags: vi.fn(() => Promise.resolve()),
  } satisfies AdminReview;
  return { review };
}

describe("tags", () => {
  test("are kept for the whole article", async () => {
    const { review } = fakes();
    const tags = { difficulty: "advanced", concepts: ["transactions"] };
    expect(await saveTags(review, "admin-1", "7", tags)).toEqual({ ok: true });
    expect(review.setTags).toHaveBeenCalledWith("7", tags, "admin-1");
  });

  test("null clears the override", async () => {
    const { review } = fakes();
    await saveTags(review, "admin-1", "7", null);
    expect(review.setTags).toHaveBeenCalledWith("7", null, "admin-1");
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
    expect((await saveTags(review, "a", "7", tags)).ok).toBe(false);
    expect(review.setTags).not.toHaveBeenCalled();
  });

  test("a repeated concept counts once", async () => {
    const { review } = fakes();
    const repeated = Array<string>(6).fill("transactions");
    const tags = { difficulty: "advanced", concepts: repeated };
    expect(await saveTags(review, "a", "7", tags)).toEqual({ ok: true });
    expect(review.setTags).toHaveBeenCalledWith(
      "7",
      { difficulty: "advanced", concepts: ["transactions"] },
      "a",
    );
  });

  test("an unknown item is refused", async () => {
    const { review } = fakes();
    expect((await saveTags(review, "a", "99", null)).ok).toBe(false);
    expect(review.setTags).not.toHaveBeenCalled();
  });
});
