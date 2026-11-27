import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  CommunityQuestions,
  Entitlements,
  JobQueue,
} from "../../../server/ports";

// Q-P7-05 (owner, 2026-11-27): the form to write a community question, for accounts
// with a verified email on a plan with questions.submit, about a section they opened.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const limit = vi.fn<Entitlements["limit"]>(() => Promise.resolve(3));
const section = vi.fn<CommunityQuestions["section"]>(() =>
  Promise.resolve({
    momentId: "9",
    title: "Raft",
    articleTitle: "Consensus in practice",
  }),
);
const allowance = vi.fn<CommunityQuestions["allowance"]>(() =>
  Promise.resolve({ verified: true, used: 1 }),
);
const submit = vi.fn<CommunityQuestions["submit"]>(() =>
  Promise.resolve({ id: "77", created: true, used: 2 }),
);
const drop = vi.fn<CommunityQuestions["drop"]>(() => Promise.resolve());
const mine = vi.fn<CommunityQuestions["mine"]>(() => Promise.resolve([]));
const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());
const emit = vi.fn();
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can, limit }),
  communityQuestions: () => ({ section, allowance, submit, drop, mine }),
  jobQueue: () => ({ enqueue }),
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
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: null };

afterEach(() => {
  vi.clearAllMocks();
});

async function page(query: Record<string, string> = { moment: "9" }) {
  const { default: WriteQuestionPage } = await import("./page");
  return renderToStaticMarkup(
    await WriteQuestionPage({ searchParams: Promise.resolve(query) }),
  );
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const filled = {
  momentId: "9",
  idempotencyKey: "key-1",
  stem: "What does a Raft leader need to commit an entry?",
  option0: "Every vote",
  option1: "A majority",
  option2: "The longest log",
  option3: "A lease",
  correct: "1",
  citation: "an entry is committed once a majority has it",
};

test("no session goes to /join, a guest to sign up", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
  current.mockResolvedValue({ ...user, isGuest: true });
  await expect(page()).rejects.toThrow("redirect:/sign-up");
  const { submitQuestionAction } = await import("./actions");
  await expect(submitQuestionAction(null, form(filled))).rejects.toThrow(
    "redirect:/sign-up",
  );
  expect(submit).not.toHaveBeenCalled();
});

test("a plan without questions.submit, a bad id or a section not opened is a 404", async () => {
  current.mockResolvedValue(user);
  can.mockResolvedValueOnce(false);
  await expect(page()).rejects.toThrow("notFound");
  await expect(page({ moment: "x" })).rejects.toThrow("notFound");
  section.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("notFound");
  can.mockResolvedValueOnce(false);
  const { submitQuestionAction } = await import("./actions");
  await expect(submitQuestionAction(null, form(filled))).rejects.toThrow(
    "notFound",
  );
});

test("a verified account gets the form and today's count; an unverified one, Verify", async () => {
  current.mockResolvedValue(user);
  const html = await page();
  expect(html).toContain("Write a question");
  expect(html).toContain("Raft — Consensus in practice");
  expect(html).toContain("You can write 2 more questions today.");
  expect(html).toContain('name="stem"');
  for (const n of ["0", "1", "2", "3"])
    expect(html).toContain(`name="option${n}"`);
  expect(
    html.match(/<input[^>]*type="radio"[^>]*name="correct"/g),
  ).toHaveLength(4);
  expect(html).toContain('name="citation"');
  expect(html).toContain('name="momentId" value="9"');
  expect(html).toMatch(/name="idempotencyKey" value="[0-9a-f-]{36}"/);
  allowance.mockResolvedValue({ verified: true, used: 3 });
  const done = await page();
  expect(done).toContain("That&#x27;s all for today.");
  expect(done).not.toContain('name="stem"');
  allowance.mockResolvedValue({ verified: false, used: 0 });
  const unverified = await page();
  expect(unverified).toContain("Verify your email to write questions.");
  expect(unverified).toContain('href="/profile#verify"');
  expect(unverified).not.toContain('name="stem"');
  allowance.mockResolvedValue({ verified: true, used: 1 });
});

// Owner, 2026-11-27: a rejection says why, so the player can rewrite the question.
test("the player's questions on the section say where each stands, and why one was not accepted", async () => {
  current.mockResolvedValue(user);
  expect(await page()).not.toContain("Your questions on this section");
  mine.mockResolvedValueOnce([
    {
      questionId: "3",
      stem: "According to the article?",
      state: "not_stand_alone",
    },
    { questionId: "2", stem: "Second?", state: "reviewing" },
    { questionId: "1", stem: "First?", state: "check" },
  ]);
  const html = await page();
  expect(mine).toHaveBeenCalledWith("u1", "9");
  expect(html).toContain("Your questions on this section");
  expect(html).toContain("Not accepted: it refers to its source");
  expect(html).toContain("Checked. Waiting for review.");
  expect(html).toContain(
    "a second model, reading only the section, chose a different answer",
  );
});

test("submitting thanks the player with the count left; a problem keeps what was typed", async () => {
  current.mockResolvedValue(user);
  const { submitQuestionAction } = await import("./actions");
  expect(await submitQuestionAction(null, form(filled))).toEqual({
    status: "sent",
    remaining: 1,
  });
  expect(submit).toHaveBeenCalledWith(
    "u1",
    {
      momentId: "9",
      stem: filled.stem,
      options: [filled.option0, filled.option1, filled.option2, filled.option3],
      correct: 1,
      citation: filled.citation,
      idempotencyKey: "key-1",
    },
    { since: expect.any(Date) as Date, limit: 3 },
  );
  expect(emit).toHaveBeenCalledWith(
    "question_submitted",
    { question_id: "77", moment_id: "9", limited: true, remaining_today: 1 },
    { ...user, sessionId: "visit-1" },
  );
  // No answer chosen is no answer, never the first.
  const unchosen = Object.fromEntries(
    Object.entries(filled).filter(([name]) => name !== "correct"),
  );
  expect(await submitQuestionAction(null, form(unchosen))).toEqual({
    status: "problem",
    message: "Choose which answer is correct.",
    values: {
      stem: filled.stem,
      options: [filled.option0, filled.option1, filled.option2, filled.option3],
      correct: "",
      citation: filled.citation,
    },
  });
  submit.mockResolvedValueOnce("daily_limit");
  expect(await submitQuestionAction(null, form(filled))).toMatchObject({
    status: "problem",
    message:
      "You've reached today's limit of questions. Come back tomorrow (UTC).",
  });
});
