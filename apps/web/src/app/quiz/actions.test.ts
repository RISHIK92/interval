import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Quizzes } from "../../server/ports";

// Test 60s (Q-P2-14, Q-P2-20, P2-W9-S01): starting, answering and finishing a sprint,
// each validated at the boundary and recorded once.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const start = vi.fn<Quizzes["start"]>();
const answer = vi.fn<Quizzes["answer"]>();
const finish = vi.fn<Quizzes["finish"]>();
const startReview = vi.fn<Quizzes["startReview"]>();
const flag = vi.fn<Quizzes["flag"]>();
const startCheckpoint = vi.fn<Quizzes["startCheckpoint"]>();
const closeStale = vi.fn<Quizzes["closeStale"]>(() => Promise.resolve([]));
const startSprint = vi.fn<Quizzes["startSprint"]>();
const can = vi.fn(() => Promise.resolve(true));
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  quizzes: () => ({
    closeStale,
    startSprint,
    start,
    answer,
    finish,
    startReview,
    flag,
    startCheckpoint,
  }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const context = { ...user, sessionId: "visit-1" };

afterEach(() => {
  vi.clearAllMocks();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function actions() {
  current.mockResolvedValue(user);
  return import("./actions");
}

test("starting a section's sprint records it and opens the quiz", async () => {
  const { startQuizAction } = await actions();
  start.mockResolvedValue({
    attemptId: "41",
    endsAt: new Date(),
    firstTime: true,
  });
  await expect(
    startQuizAction(
      form({ itemId: "5", momentId: "9", chip: "3-8", back: "/read/5" }),
    ),
  ).rejects.toThrow("redirect:/quiz/41?chip=3-8");
  expect(start).toHaveBeenCalledWith("u1", "5", "9");
  expect(emit).toHaveBeenCalledWith(
    "quiz_started",
    { attempt_id: "41", kind: "test", item_id: "5", moment_id: "9" },
    context,
  );
  // A double-tap returns the running sprint (LOAD-5): opened, not recorded again.
  emit.mockClear();
  start.mockResolvedValue({
    attemptId: "41",
    endsAt: new Date(),
    firstTime: false,
  });
  await expect(
    startQuizAction(form({ itemId: "5", momentId: "9", chip: "3-8" })),
  ).rejects.toThrow("redirect:/quiz/41?chip=3-8");
  expect(emit).not.toHaveBeenCalled();
});

test("an article's sprint has no section; no live questions goes back", async () => {
  const { startQuizAction } = await actions();
  start.mockResolvedValue(null);
  await expect(
    startQuizAction(form({ itemId: "5", chip: "3-8", back: "/read/5" })),
  ).rejects.toThrow("redirect:/read/5");
  expect(start).toHaveBeenCalledWith("u1", "5", null);
  expect(emit).not.toHaveBeenCalled();
});

test("an answer is recorded once, with its time to answer", async () => {
  const { answerQuizAction } = await actions();
  const servedAt = new Date("2026-10-28T10:00:00Z");
  answer.mockResolvedValue({
    correct: true,
    correctOption: 2,
    servedAt,
    answeredAt: new Date(servedAt.getTime() + 4200),
    firstTime: true,
  });
  await expect(
    answerQuizAction(
      form({ attemptId: "41", questionId: "7", chosen: "2", chip: "3-8" }),
    ),
  ).rejects.toThrow("redirect:/quiz/41?chip=3-8&answered=7");
  expect(answer).toHaveBeenCalledWith("u1", "41", "7", 2);
  expect(emit).toHaveBeenCalledWith(
    "quiz_answered",
    { attempt_id: "41", question_id: "7", result: "right", ms: 4200 },
    context,
  );
  // A resubmission (LOAD-5) shows the same feedback but isn't counted again.
  emit.mockClear();
  answer.mockResolvedValue({
    correct: true,
    correctOption: 2,
    servedAt,
    answeredAt: new Date(servedAt.getTime() + 4200),
    firstTime: false,
  });
  await expect(
    answerQuizAction(
      form({ attemptId: "41", questionId: "7", chosen: "2", chip: "3-8" }),
    ),
  ).rejects.toThrow("redirect:/quiz/41?chip=3-8&answered=7");
  expect(emit).not.toHaveBeenCalled();
});

test("a late or foreign answer records nothing", async () => {
  const { answerQuizAction } = await actions();
  for (const got of ["late", null] as const) {
    answer.mockResolvedValue(got);
    await expect(
      answerQuizAction(
        form({ attemptId: "41", questionId: "7", chosen: "1", chip: "3-8" }),
      ),
    ).rejects.toThrow("redirect:/quiz/41?chip=3-8");
  }
  expect(emit).not.toHaveBeenCalled();
});

test("finishing reports once", async () => {
  const { finishQuizAction } = await actions();
  finish.mockResolvedValue({
    answered: 6,
    correct: 4,
    firstTime: true,
    sprint: false,
    checkpoint: null,
  });
  await expect(
    finishQuizAction(form({ attemptId: "41", chip: "3-8" })),
  ).rejects.toThrow("redirect:/quiz/41/results?chip=3-8");
  expect(emit).toHaveBeenCalledWith(
    "quiz_finished",
    { attempt_id: "41", answered: 6, correct: 4 },
    context,
  );
  emit.mockClear();
  finish.mockResolvedValue({
    answered: 6,
    correct: 4,
    firstTime: false,
    sprint: false,
    checkpoint: null,
  });
  await expect(
    finishQuizAction(form({ attemptId: "41", chip: "3-8" })),
  ).rejects.toThrow("redirect:/quiz/41/results?chip=3-8");
  expect(emit).not.toHaveBeenCalled();
});

test.each([
  ["start", { itemId: "x", chip: "3-8" }],
  ["start", { itemId: "5", momentId: "0", chip: "3-8" }],
  ["answer", { attemptId: "41", questionId: "7", chosen: "4", chip: "3-8" }],
  ["answer", { attemptId: "41", questionId: "7", chosen: "a", chip: "3-8" }],
  ["answer", { attemptId: "-1", questionId: "7", chosen: "1", chip: "3-8" }],
  ["finish", { attemptId: "x", chip: "3-8" }],
  ["finish", { attemptId: "41", chip: "huge" }],
  ["start", { itemId: "5" }],
] as const)(
  "bad input to %s goes home without a call",
  async (kind, fields) => {
    const all = await actions();
    const action = {
      start: all.startQuizAction,
      answer: all.answerQuizAction,
      finish: all.finishQuizAction,
    }[kind];
    await expect(action(form(fields))).rejects.toThrow("redirect:/");
    expect(start).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  },
);

// P2-W9-S05 (Q-P2-17): a review session over the concepts that have come due.
test("starting a review records it once and opens it; nothing due goes back", async () => {
  const { startReviewAction } = await actions();
  startReview.mockResolvedValue({
    attemptId: "52",
    concepts: 3,
    firstTime: true,
  });
  await expect(startReviewAction(form({ chip: "1-3" }))).rejects.toThrow(
    "redirect:/quiz/52?chip=1-3",
  );
  expect(startReview).toHaveBeenCalledWith("u1");
  expect(emit).toHaveBeenCalledWith(
    "quiz_started",
    { attempt_id: "52", kind: "review", item_id: null, moment_id: null },
    context,
  );
  emit.mockClear();
  startReview.mockResolvedValue({
    attemptId: "52",
    concepts: 3,
    firstTime: false,
  });
  await expect(startReviewAction(form({ chip: "1-3" }))).rejects.toThrow(
    "redirect:/quiz/52?chip=1-3",
  );
  expect(emit).not.toHaveBeenCalled();
  startReview.mockResolvedValue(null);
  await expect(startReviewAction(form({ chip: "1-3" }))).rejects.toThrow(
    "redirect:/library",
  );
  await expect(startReviewAction(form({ chip: "huge" }))).rejects.toThrow(
    "redirect:/library",
  );
});

// P2-W9-S07 (Q-2, Q-P2-18, Q-P2-20): flagging, recorded once.
test("a flag is recorded once and goes back to the question's feedback", async () => {
  const { flagQuestionAction } = await actions();
  flag.mockResolvedValue(true);
  const fields = {
    attemptId: "41",
    questionId: "7",
    reason: "wrong_key",
    chip: "3-8",
  };
  await expect(flagQuestionAction(form(fields))).rejects.toThrow(
    "redirect:/quiz/41?chip=3-8&answered=7",
  );
  expect(flag).toHaveBeenCalledWith("u1", "41", "7", "wrong_key");
  expect(emit).toHaveBeenCalledWith(
    "question_flagged",
    { question_id: "7", reason: "wrong_key" },
    context,
  );
  emit.mockClear();
  flag.mockResolvedValue(false);
  await expect(flagQuestionAction(form(fields))).rejects.toThrow(
    "redirect:/quiz/41?chip=3-8&answered=7",
  );
  expect(emit).not.toHaveBeenCalled();
  flag.mockClear();
  await expect(
    flagQuestionAction(form({ ...fields, reason: "spam" })),
  ).rejects.toThrow("redirect:/");
  expect(flag).not.toHaveBeenCalled();
});

test("Close finishes and goes back to the feed", async () => {
  const { finishQuizAction } = await actions();
  finish.mockResolvedValue({
    answered: 1,
    correct: 1,
    firstTime: true,
    sprint: false,
    checkpoint: null,
  });
  await expect(
    finishQuizAction(form({ attemptId: "41", chip: "1-3", leave: "feed" })),
  ).rejects.toThrow("redirect:/?chip=1-3");
  // Leaving a review goes back to the Library, where it started (P2-W9-S05).
  await expect(
    finishQuizAction(form({ attemptId: "41", chip: "1-3", leave: "library" })),
  ).rejects.toThrow("redirect:/library");
});

test("signed out goes to join", async () => {
  const { startQuizAction } = await actions();
  current.mockResolvedValue(null);
  await expect(
    startQuizAction(form({ itemId: "5", chip: "3-8" })),
  ).rejects.toThrow("redirect:/join");
});

// P2-W10-S04 (§5F, Q-P2-26, Q-P2-28): checkpoints.
test("a checkpoint starts once, recorded, and opens the quiz; not ready goes back", async () => {
  const { startCheckpointAction } = await actions();
  const fields = { sectionId: "60", chip: "3-8", back: "/paths/6" };
  startCheckpoint.mockResolvedValue({
    attemptId: "41",
    pathId: "6",
    firstTime: true,
  });
  await expect(startCheckpointAction(form(fields))).rejects.toThrow(
    "redirect:/quiz/41?chip=3-8",
  );
  expect(startCheckpoint).toHaveBeenCalledWith("u1", "60");
  expect(emit).toHaveBeenCalledWith(
    "checkpoint_started",
    { attempt_id: "41", path_id: "6", section_id: "60" },
    context,
  );
  emit.mockClear();
  startCheckpoint.mockResolvedValue({
    attemptId: "41",
    pathId: "6",
    firstTime: false,
  });
  await expect(startCheckpointAction(form(fields))).rejects.toThrow(
    "redirect:/quiz/41?chip=3-8",
  );
  expect(emit).not.toHaveBeenCalled();
  startCheckpoint.mockResolvedValue(null);
  await expect(startCheckpointAction(form(fields))).rejects.toThrow(
    "redirect:/paths/6",
  );
  await expect(
    startCheckpointAction(form({ ...fields, sectionId: "x" })),
  ).rejects.toThrow("redirect:/paths");
});

test("a checkpoint's finish reports whether it passed; Close goes back to the path", async () => {
  const { finishQuizAction } = await actions();
  finish.mockResolvedValue({
    answered: 5,
    correct: 4,
    firstTime: true,
    sprint: false,
    checkpoint: {
      at: { kind: "path", pathId: "6", sectionId: "60" },
      passed: true,
    },
  });
  await expect(
    finishQuizAction(form({ attemptId: "41", chip: "3-8", leave: "path" })),
  ).rejects.toThrow("redirect:/paths/6");
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith(
    "checkpoint_finished",
    {
      attempt_id: "41",
      path_id: "6",
      section_id: "60",
      answered: 5,
      correct: 4,
      passed: true,
    },
    context,
  );
});

// Owner, 2026-10-28 (Q-P2-28): a start closes quizzes left open, and records them.
test("a start records the finishes of the quizzes it closed, then its own start", async () => {
  const { startCheckpointAction, startReviewAction } = await actions();
  closeStale.mockResolvedValueOnce([
    {
      attemptId: "30",
      answered: 3,
      correct: 2,
      firstTime: true,
      sprint: false,
      checkpoint: null,
    },
    {
      attemptId: "31",
      answered: 5,
      correct: 4,
      firstTime: true,
      sprint: false,
      checkpoint: {
        at: { kind: "path", pathId: "6", sectionId: "60" },
        passed: true,
      },
    },
  ]);
  startCheckpoint.mockResolvedValue({
    attemptId: "41",
    pathId: "6",
    firstTime: true,
  });
  await expect(
    startCheckpointAction(form({ sectionId: "61", chip: "3-8" })),
  ).rejects.toThrow("redirect:/quiz/41?chip=3-8");
  expect(closeStale).toHaveBeenCalledWith("u1");
  expect(emit.mock.calls.map((c): unknown => c[0])).toEqual([
    "quiz_finished",
    "checkpoint_finished",
    "checkpoint_started",
  ]);
  expect(emit).toHaveBeenCalledWith(
    "checkpoint_finished",
    {
      attempt_id: "31",
      path_id: "6",
      section_id: "60",
      answered: 5,
      correct: 4,
      passed: true,
    },
    context,
  );
  emit.mockClear();
  closeStale.mockResolvedValueOnce([
    {
      attemptId: "32",
      answered: 1,
      correct: 1,
      firstTime: true,
      sprint: false,
      checkpoint: null,
    },
  ]);
  startReview.mockResolvedValue(null);
  await expect(startReviewAction(form({ chip: "3-8" }))).rejects.toThrow(
    "redirect:/library",
  );
  expect(emit).toHaveBeenCalledWith(
    "quiz_finished",
    { attempt_id: "32", answered: 1, correct: 1 },
    context,
  );
});

// P3-W13-S02 (§6.3, OPS-3, ADR-0029): a solo sprint from Play, guests included.
test("a sprint starts from Play, recorded once as a game, and opens the quiz", async () => {
  const { startSprintAction } = await actions();
  current.mockResolvedValue({ ...user, isGuest: true });
  startSprint.mockResolvedValue({
    attemptId: "61",
    endsAt: new Date(Date.now() + 60_000),
    firstTime: true,
  });
  await expect(startSprintAction()).rejects.toThrow(
    "redirect:/quiz/61?chip=3-8",
  );
  expect(can).toHaveBeenCalledWith("u1", "play.sprint");
  expect(closeStale).toHaveBeenCalledWith("u1");
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "game_started",
    { attempt_id: "61", game: "sprint" },
    { ...context, isGuest: true },
  );
  emit.mockClear();
  startSprint.mockResolvedValue({
    attemptId: "61",
    endsAt: new Date(Date.now() + 60_000),
    firstTime: false,
  });
  await expect(startSprintAction()).rejects.toThrow("redirect:/quiz/61");
  expect(emit).not.toHaveBeenCalled();
});

test("without play.sprint, or with nothing left to ask this week, a sprint goes back to Play", async () => {
  const { startSprintAction } = await actions();
  can.mockResolvedValueOnce(false);
  await expect(startSprintAction()).rejects.toThrow(/^redirect:\/play$/);
  expect(startSprint).not.toHaveBeenCalled();
  startSprint.mockResolvedValue(null);
  await expect(startSprintAction()).rejects.toThrow(
    /^redirect:\/play\?sprint=none$/,
  );
  expect(emit).not.toHaveBeenCalled();
});

test("a sprint's finish is a game_finished, not a quiz_finished; Close goes to Play", async () => {
  const { finishQuizAction } = await actions();
  finish.mockResolvedValue({
    answered: 7,
    correct: 5,
    firstTime: true,
    checkpoint: null,
    sprint: true,
  });
  await expect(
    finishQuizAction(form({ attemptId: "61", chip: "3-8", leave: "play" })),
  ).rejects.toThrow("redirect:/play");
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "game_finished",
    { attempt_id: "61", game: "sprint", answered: 7, correct: 5 },
    context,
  );
});

test("Start just after a sprint's clock ran out finishes it, records it, and starts afresh", async () => {
  const { startSprintAction } = await actions();
  startSprint
    .mockResolvedValueOnce({
      attemptId: "61",
      endsAt: new Date(Date.now() - 2_000),
      firstTime: false,
    })
    .mockResolvedValueOnce({
      attemptId: "62",
      endsAt: new Date(Date.now() + 60_000),
      firstTime: true,
    });
  finish.mockResolvedValue({
    answered: 3,
    correct: 2,
    firstTime: true,
    checkpoint: null,
    sprint: true,
  });
  await expect(startSprintAction()).rejects.toThrow(
    "redirect:/quiz/62?chip=3-8",
  );
  expect(finish).toHaveBeenCalledWith("u1", "61");
  expect(emit.mock.calls.map((c: unknown[]) => c[0])).toEqual([
    "game_finished",
    "game_started",
  ]);
});

// ADR-0029: guests play, but a flag takes a question out of every quiz.
test("a guest's flag is refused: nothing recorded, back to the feedback", async () => {
  const { flagQuestionAction } = await actions();
  current.mockResolvedValue({ ...user, isGuest: true });
  await expect(
    flagQuestionAction(
      form({
        attemptId: "61",
        questionId: "7",
        reason: "wrong_key",
        chip: "3-8",
      }),
    ),
  ).rejects.toThrow("redirect:/quiz/61?chip=3-8&answered=7");
  expect(flag).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});
