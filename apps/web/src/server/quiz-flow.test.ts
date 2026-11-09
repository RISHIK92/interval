import { afterEach, expect, test, vi } from "vitest";

// P4-W21-S04 (Q-P2-35): a book chapter's checkpoint starts as the web's action started
// it: any quiz left open closed first, and book_checkpoint_started recorded once.
const closeStale = vi.fn(() => Promise.resolve([]));
const startBookCheckpoint = vi.fn();
const emit = vi.fn();
vi.mock("./container", () => ({
  quizzes: () => ({ closeStale, startBookCheckpoint }),
  events: () => ({ emit }),
  leaderboards: () => ({}),
  entitlements: () => ({}),
}));

const context = {
  userId: "u1",
  isGuest: false,
  betaGroup: "student" as const,
  sessionId: null,
};
afterEach(() => {
  vi.clearAllMocks();
});

test("a chapter checkpoint: left-open quizzes closed, the start recorded once", async () => {
  const { startBookCheckpoint: start } = await import("./quiz-flow");
  startBookCheckpoint.mockResolvedValueOnce({
    attemptId: "60",
    bookId: "4",
    firstTime: true,
  });
  expect(await start(context, "8")).toEqual({ attemptId: "60" });
  expect(closeStale).toHaveBeenCalledWith("u1");
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "book_checkpoint_started",
    { attempt_id: "60", book_id: "4", chapter_id: "8" },
    context,
  );
  // The same attempt again (a repeat): nothing recorded.
  startBookCheckpoint.mockResolvedValueOnce({
    attemptId: "60",
    bookId: "4",
    firstTime: false,
  });
  await start(context, "8");
  expect(emit).toHaveBeenCalledTimes(1);
  startBookCheckpoint.mockResolvedValueOnce(null);
  expect(await start(context, "8")).toBeNull();
});
