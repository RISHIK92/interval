import { afterEach, expect, test, vi } from "vitest";

// P4-W21-S04 (Q-P2-35): a book chapter's checkpoint starts as the web's action started
// it: any quiz left open closed first, and book_checkpoint_started recorded once.
const closeStale = vi.fn(() => Promise.resolve([]));
const startBookCheckpoint = vi.fn();
const emit = vi.fn();
const finish = vi.fn();
const enqueue = vi.fn(() => Promise.resolve());
vi.mock("./container", () => ({
  quizzes: () => ({ closeStale, startBookCheckpoint, finish }),
  events: () => ({ emit }),
  leaderboards: () => ({ record: () => Promise.resolve() }),
  entitlements: () => ({}),
  jobQueue: () => ({ enqueue }),
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

// ADR-0045: a passed checkpoint earns league points, queued at every finish (the worker
// writes them once); a failed one, or a quiz that isn't a checkpoint, queues nothing.
test("a passed checkpoint's league points are queued at each finish", async () => {
  const { finishAttempt } = await import("./quiz-flow");
  const done = (passed: boolean | null) => ({
    answered: 5,
    correct: 4,
    firstTime: false,
    checkpoint:
      passed === null
        ? null
        : { at: { kind: "path", pathId: "1", sectionId: "2" }, passed },
    sprint: false,
    estimation: null,
    daily: null,
    missed: [],
  });
  finish.mockResolvedValueOnce(done(true));
  await finishAttempt(context, "61");
  expect(enqueue).toHaveBeenCalledExactlyOnceWith(
    "league_points",
    { source_kind: "checkpoint", source_id: "61" },
    { idempotencyKey: "league-checkpoint-61" },
  );
  finish.mockResolvedValueOnce(done(false));
  await finishAttempt(context, "62");
  finish.mockResolvedValueOnce(done(null));
  await finishAttempt(context, "63");
  expect(enqueue).toHaveBeenCalledTimes(1);
});

test("a queue that is down leaves the checkpoint's finish standing, logged", async () => {
  const { finishAttempt } = await import("./quiz-flow");
  const { log } = await import("./log");
  const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
  enqueue.mockRejectedValueOnce(new Error("down"));
  finish.mockResolvedValueOnce({
    answered: 5,
    correct: 5,
    firstTime: false,
    checkpoint: {
      at: { kind: "book", bookId: "1", chapterId: "2" },
      passed: true,
    },
    sprint: false,
    estimation: null,
    daily: null,
    missed: [],
  });
  expect(await finishAttempt(context, "64")).not.toBeNull();
  expect(error).toHaveBeenCalledWith(
    "leagues: points not queued",
    expect.objectContaining({ attemptId: "64" }),
  );
});

// Owner, 2026-11-26: the daily challenge earns league points (the worker scores each
// day's once); other solo games earn none.
test("a finished daily challenge queues its league points; a sprint doesn't", async () => {
  const { finishAttempt } = await import("./quiz-flow");
  const solo = (daily: { points: number } | null) => ({
    answered: 5,
    correct: 3,
    firstTime: true,
    checkpoint: null,
    sprint: true,
    estimation: null,
    daily,
    missed: [],
  });
  finish.mockResolvedValueOnce(solo({ points: 350 }));
  await finishAttempt(context, "70");
  expect(enqueue).toHaveBeenCalledExactlyOnceWith(
    "league_points",
    { source_kind: "daily", source_id: "70" },
    { idempotencyKey: "league-daily-70" },
  );
  finish.mockResolvedValueOnce(solo(null));
  await finishAttempt(context, "71");
  expect(enqueue).toHaveBeenCalledTimes(1);
});
