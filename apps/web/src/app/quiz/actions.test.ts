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
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  quizzes: () => ({ start, answer, finish, startReview, flag }),
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
  finish.mockResolvedValue({ answered: 6, correct: 4, firstTime: true });
  await expect(
    finishQuizAction(form({ attemptId: "41", chip: "3-8" })),
  ).rejects.toThrow("redirect:/quiz/41/results?chip=3-8");
  expect(emit).toHaveBeenCalledWith(
    "quiz_finished",
    { attempt_id: "41", answered: 6, correct: 4 },
    context,
  );
  emit.mockClear();
  finish.mockResolvedValue({ answered: 6, correct: 4, firstTime: false });
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
  finish.mockResolvedValue({ answered: 1, correct: 1, firstTime: true });
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
