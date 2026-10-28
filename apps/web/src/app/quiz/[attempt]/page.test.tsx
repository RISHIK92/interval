import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, QuizAttempt, Quizzes } from "../../../server/ports";

// Test 60s (Q-P2-14, P2-W9-S02, wireframe 12 variant test): one question at a time,
// instant feedback, the server's clock.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const attempt = vi.fn<Quizzes["attempt"]>();
const next = vi.fn<Quizzes["next"]>();
const answered = vi.fn<Quizzes["answered"]>();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  quizzes: () => ({ attempt, next, answered }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const running: QuizAttempt = {
  review: false,
  itemId: "5",
  momentId: "9",
  title: "Raft",
  startedAt: new Date(Date.now() - 20_000),
  endsAt: new Date(Date.now() + 40_000),
  secondsLeft: 40,
  finishedAt: null,
  answered: 2,
  correct: 1,
  avgMs: 4000,
  concepts: [{ name: "Raft", state: "explored" }],
  checkpoint: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

async function render(
  search: Record<string, string>,
  got: QuizAttempt | null = running,
) {
  current.mockResolvedValue(user);
  attempt.mockResolvedValue(got);
  const { default: QuizPage } = await import("./page");
  return renderToStaticMarkup(
    await QuizPage({
      params: Promise.resolve({ attempt: "41" }),
      searchParams: Promise.resolve(search),
    }),
  );
}

test("a question is four answer buttons and never its key", async () => {
  next.mockResolvedValue({
    questionId: "7",
    stem: "What does a candidate need?",
    options: ["A majority", "Everyone", "The longest log", "A lease"],
    servedAt: new Date(),
  });
  const html = await render({ chip: "3-8" });
  expect(next).toHaveBeenCalledWith("u1", "41");
  expect(html).toContain("Test yourself · 60s");
  expect(html).toContain("What does a candidate need?");
  expect(html.match(/name="chosen"/g)).toHaveLength(4);
  for (const i of [0, 1, 2, 3]) expect(html).toContain(`value="${String(i)}"`);
  expect(html).toContain('name="questionId" value="7"');
  expect(html).toContain('name="chip" value="3-8"');
  // 2 answered so far; the countdown and Close are there.
  expect(html).toContain("2 answered");
  expect(html).toContain("Close");
  expect(html).not.toMatch(/correct/i);
});

test("feedback marks the choice and the right option in words", async () => {
  answered.mockResolvedValue({
    stem: "What does a candidate need?",
    options: ["A majority", "Everyone", "The longest log", "A lease"],
    chosen: 1,
    correctOption: 0,
    correct: false,
    flagged: false,
  });
  const html = await render({ chip: "3-8", answered: "7" });
  expect(answered).toHaveBeenCalledWith("u1", "41", "7");
  expect(next).not.toHaveBeenCalled();
  expect(html).toContain("Not quite.");
  expect(html).toContain("Your answer");
  expect(html).toContain("Right answer");
  expect(html).toContain('href="/quiz/41?chip=3-8"');
  // Owner, 2026-10-28: no Finish; the sprint runs to its end or is exited.
  expect(html).not.toContain(">Finish<");
});

test("Close warns before exiting; exiting ends the test and leaves", async () => {
  next.mockResolvedValue({
    questionId: "7",
    stem: "Q?",
    options: ["a", "b", "c", "d"],
    servedAt: new Date(),
  });
  const html = await render({ chip: "3-8" });
  // Owner, 2026-10-28: warn that exiting affects the score.
  expect(html).toMatch(/<button[^>]*popovertarget="quiz-exit"[^>]*>/i);
  expect(html).toContain(
    "Exiting now ends this test and will affect your score.",
  );
  expect(html).toMatch(
    /<form[^>]*>(?:(?!<\/form>)[^])*name="leave" value="feed"(?:(?!<\/form>)[^])*Exit test/,
  );
  expect(html).toContain("Keep going");
});

test("a right answer says so", async () => {
  answered.mockResolvedValue({
    stem: "Q?",
    options: ["a", "b", "c", "d"],
    chosen: 2,
    correctOption: 2,
    correct: true,
    flagged: false,
  });
  const html = await render({ chip: "3-8", answered: "7" });
  expect(html).toContain("Correct.");
  expect(html).not.toContain("Your answer");
});

test("when time is up or the questions run out, it offers Finish", async () => {
  next.mockResolvedValue("over");
  const html = await render(
    { chip: "3-8" },
    { ...running, endsAt: new Date(Date.now() - 1_000), secondsLeft: 0 },
  );
  expect(html).toContain("Time&#x27;s up");
  expect(html).toContain("See results");
  // Out of questions with time left: it ends early, and says so (Q-P2-14).
  const early = await render({ chip: "3-8" });
  expect(early).toContain("That&#x27;s every question for now.");
  expect(early).not.toContain("Time&#x27;s up");
});

test("the footer names where the questions come from", async () => {
  next.mockResolvedValue("over");
  expect(await render({ chip: "3-8" })).toContain(
    "Questions from this section",
  );
  expect(
    await render({ chip: "3-8" }, { ...running, momentId: null }),
  ).toContain("Questions from this article");
});

test("a finished attempt goes to its results", async () => {
  await expect(
    render({ chip: "1-3" }, { ...running, finishedAt: new Date() }),
  ).rejects.toThrow("redirect:/quiz/41/results?chip=1-3");
});

test("someone else's attempt, or bad input, goes home", async () => {
  await expect(render({ chip: "3-8" }, null)).rejects.toThrow("redirect:/");
  await expect(render({ chip: "huge" })).rejects.toThrow("redirect:/");
  await expect(render({ chip: "3-8", answered: "x" })).rejects.toThrow(
    "redirect:/",
  );
});

test("feedback for a question not answered goes back to the quiz", async () => {
  answered.mockResolvedValue(null);
  await expect(render({ chip: "3-8", answered: "7" })).rejects.toThrow(
    "redirect:/quiz/41?chip=3-8",
  );
});

// P2-W9-S05: a review is untimed, one question per concept due.
test("a review has no clock and says when every due concept is done", async () => {
  const review: QuizAttempt = {
    ...running,
    review: true,
    itemId: null,
    momentId: null,
    title: "Review",
    endsAt: null,
    secondsLeft: null,
  };
  next.mockResolvedValue({
    questionId: "7",
    stem: "Q?",
    options: ["a", "b", "c", "d"],
    servedAt: new Date(),
  });
  const html = await render({ chip: "3-8" }, review);
  expect(html).toContain("Review");
  expect(html).not.toContain('role="progressbar"');
  expect(html).toContain("One question per concept due for review");
  // Leaving a review: its own words, and back to the Library.
  expect(html).toContain(
    "Exiting ends this review. Concepts you haven&#x27;t answered stay due.",
  );
  expect(html).toContain('name="leave" value="library"');
  expect(html).not.toContain("will affect your score");
  next.mockResolvedValue("over");
  const done = await render({ chip: "3-8" }, review);
  expect(done).toContain("That&#x27;s every concept due.");
  expect(done).toContain("See results");
});

// P2-W9-S07 (Q-P2-18): a Flag control on each answered question.
test("an answered question can be flagged with a reason, then says it was", async () => {
  answered.mockResolvedValue({
    stem: "Q?",
    options: ["a", "b", "c", "d"],
    chosen: 2,
    correctOption: 2,
    correct: true,
    flagged: false,
  });
  const html = await render({ chip: "3-8", answered: "7" });
  expect(html).toContain("Report a problem with this question");
  for (const value of ["wrong_key", "unclear", "not_in_section", "other"])
    expect(html).toContain(`value="${value}"`);
  expect(html).toContain("The answer marked right is wrong");
  // No reason is picked for the user: the metric's reasons are theirs.
  expect(html).not.toMatch(/name="reason"[^>]*checked/);
  expect(html).toContain("What&#x27;s wrong with it?");
  expect(html).not.toMatch(/sr-only[^>]*>What/);
  expect(html).toMatch(
    /<form[^>]*>(?:(?!<\/form>)[^])*name="questionId" value="7"(?:(?!<\/form>)[^])*Send report/,
  );
  answered.mockResolvedValue({
    stem: "Q?",
    options: ["a", "b", "c", "d"],
    chosen: 2,
    correctOption: 2,
    correct: true,
    flagged: true,
  });
  const done = await render({ chip: "3-8", answered: "7" });
  expect(done).not.toContain("Send report");
  expect(done).toContain("Thanks. This question is out of quizzes until it");
});

test("a checkpoint says what passing unlocks, and Close goes back to the path", async () => {
  next.mockResolvedValue({
    questionId: "7",
    stem: "What does a quorum need?",
    options: ["A majority", "Everyone", "One", "None"],
    servedAt: new Date(),
  });
  const html = await render(
    { chip: "3-8" },
    {
      ...running,
      itemId: null,
      momentId: null,
      title: "Quorums",
      checkpoint: {
        at: { kind: "path", pathId: "6", sectionId: "60" },
        title: "Quorums",
        concepts: ["Quorums"],
        size: 5,
        passMark: 4,
        passed: false,
        next: ["Leases"],
        missed: ["Quorums"],
      },
    },
  );
  expect(html).toContain("Checkpoint · 60s");
  expect(html).toContain("Pass 4 of 5 to unlock Leases");
  expect(html).toContain("Exit the checkpoint?");
  expect(html).toContain('name="leave" value="path"');
  expect(html).not.toContain("Test yourself");
});
