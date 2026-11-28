import { afterEach, expect, test, vi } from "vitest";
import type { Progress } from "./ports";

const recordOpen = vi.fn<Progress["recordOpen"]>(() => Promise.resolve());
const countExploreOpen = vi.fn<Progress["countExploreOpen"]>(() =>
  Promise.resolve(),
);
const emit = vi.fn();
vi.mock("./container", () => ({
  progress: () => ({ recordOpen, countExploreOpen }),
  events: () => ({ emit }),
}));

const context = {
  userId: "u1",
  isGuest: false,
  betaGroup: "student" as const,
  sessionId: "visit-1",
};

afterEach(() => {
  vi.clearAllMocks();
});

// ADR-0058: any open makes the article Continue reading; a feed card's open is counted
// by the article alone.
test("a feed card's open records the article, its arm and card_opened by id", async () => {
  const { countOpen } = await import("./opens");
  await countOpen(context, {
    itemId: "5",
    card: { pos: 2, via: "feed" },
    from: undefined,
    surface: "in_app",
  });
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("u1", "5");
  expect(countExploreOpen).toHaveBeenCalledExactlyOnceWith("u1", "5");
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "card_opened",
    { position: 2, item_id: "5", surface: "in_app", via: "feed" },
    context,
  );
});

test.each(["library", "path", "explore", "reader"] as const)(
  "an open from %s is still Continue reading, and counts no feed event",
  async (from) => {
    const { countOpen } = await import("./opens");
    await countOpen(context, {
      itemId: "5",
      card: null,
      from,
      surface: "browser",
    });
    expect(recordOpen).toHaveBeenCalledExactlyOnceWith("u1", "5");
    expect(countExploreOpen).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  },
);

test("a Continue link counts continue_clicked", async () => {
  const { countOpen } = await import("./opens");
  await countOpen(context, {
    itemId: "5",
    card: null,
    from: "continue",
    surface: "browser",
  });
  expect(emit).toHaveBeenCalledExactlyOnceWith("continue_clicked", {}, context);
});

// §8: the publisher's page, attributed, its own query and fragment kept as they are.
test.each([
  ["https://blog.dev/raft", "https://blog.dev/raft?utm_source=interval"],
  [
    "https://blog.dev/raft?a=%20",
    "https://blog.dev/raft?a=%20&utm_source=interval",
  ],
  [
    "https://blog.dev/raft#top",
    "https://blog.dev/raft?utm_source=interval#top",
  ],
  ["javascript:alert(1)", null],
  ["not a url", null],
])("attributed(%s)", async (stored, url) => {
  const { attributed } = await import("./opens");
  expect(attributed(stored)).toBe(url);
});
