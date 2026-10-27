import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Quizzes } from "../../server/ports";

// Test 60s (Q-P2-14, Q-P2-20, P2-W9-S01): starting, answering and finishing a sprint,
// each validated at the boundary and recorded once.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const start = vi.fn<Quizzes["start"]>();
const answer = vi.fn<Quizzes["answer"]>();
const finish = vi.fn<Quizzes["finish"]>();
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  quizzes: () => ({ start, answer, finish }),
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
    startQuizAction(form({ itemId: "5", momentId: "9", back: "/read/5" })),
  ).rejects.toThrow("redirect:/quiz/41");
  expect(start).toHaveBeenCalledWith("u1", "5", "9");
  expect(emit).toHaveBeenCalledWith(
    "quiz_started",
    { attempt_id: "41", item_id: "5", moment_id: "9" },
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
    startQuizAction(form({ itemId: "5", momentId: "9" })),
  ).rejects.toThrow("redirect:/quiz/41");
  expect(emit).not.toHaveBeenCalled();
});

test("an article's sprint has no section; no live questions goes back", async () => {
  const { startQuizAction } = await actions();
  start.mockResolvedValue(null);
  await expect(
    startQuizAction(form({ itemId: "5", back: "/read/5" })),
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
    answerQuizAction(form({ attemptId: "41", questionId: "7", chosen: "2" })),
  ).rejects.toThrow("redirect:/quiz/41?answered=7");
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
    answerQuizAction(form({ attemptId: "41", questionId: "7", chosen: "2" })),
  ).rejects.toThrow("redirect:/quiz/41?answered=7");
  expect(emit).not.toHaveBeenCalled();
});

test("a late or foreign answer records nothing", async () => {
  const { answerQuizAction } = await actions();
  for (const got of ["late", null] as const) {
    answer.mockResolvedValue(got);
    await expect(
      answerQuizAction(form({ attemptId: "41", questionId: "7", chosen: "1" })),
    ).rejects.toThrow("redirect:/quiz/41");
  }
  expect(emit).not.toHaveBeenCalled();
});

test("finishing reports once", async () => {
  const { finishQuizAction } = await actions();
  finish.mockResolvedValue({ answered: 6, correct: 4, firstTime: true });
  await expect(finishQuizAction(form({ attemptId: "41" }))).rejects.toThrow(
    "redirect:/quiz/41/results",
  );
  expect(emit).toHaveBeenCalledWith(
    "quiz_finished",
    { attempt_id: "41", answered: 6, correct: 4 },
    context,
  );
  emit.mockClear();
  finish.mockResolvedValue({ answered: 6, correct: 4, firstTime: false });
  await expect(finishQuizAction(form({ attemptId: "41" }))).rejects.toThrow(
    "redirect:/quiz/41/results",
  );
  expect(emit).not.toHaveBeenCalled();
});

test.each([
  ["start", { itemId: "x" }],
  ["start", { itemId: "5", momentId: "0" }],
  ["answer", { attemptId: "41", questionId: "7", chosen: "4" }],
  ["answer", { attemptId: "41", questionId: "7", chosen: "a" }],
  ["answer", { attemptId: "-1", questionId: "7", chosen: "1" }],
  ["finish", { attemptId: "x" }],
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

test("signed out goes to join", async () => {
  const { startQuizAction } = await actions();
  current.mockResolvedValue(null);
  await expect(startQuizAction(form({ itemId: "5" }))).rejects.toThrow(
    "redirect:/join",
  );
});
