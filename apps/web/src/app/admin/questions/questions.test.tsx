import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AdminQuestions,
  ReviewQuestion,
} from "../../../server/ports";

// Q-2, P2-W8-S03: the spot-check page and its actions exist only for admin.review.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const open = vi.fn<AdminQuestions["open"]>(() => Promise.resolve([]));
const decide = vi.fn<AdminQuestions["decide"]>(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminQuestions: () => ({ open, decide }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const admin: Actor = { userId: "a1", isGuest: false, betaGroup: "developer" };

afterEach(() => {
  vi.clearAllMocks();
});

const question: ReviewQuestion = {
  questionId: "42",
  reason: "flagged",
  stem: "What does a candidate need?",
  options: ["Every vote", "A majority", "The longest log", "A lease"],
  correct: 1,
  validatorAnswer: 1,
  citation: "A candidate needs votes from a majority.",
  articleTitle: "Consensus in practice",
  sectionTitle: "Raft",
  link: "https://pub.test/post#raft",
};

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: QuestionsPage } = await import("./page");
  return renderToStaticMarkup(
    await QuestionsPage({ searchParams: Promise.resolve(query) }),
  );
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("only admin.review holders see the page or can decide", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  const { decideAction } = await import("./actions");
  await expect(
    decideAction(form({ questionId: "42", decision: "keep" })),
  ).rejects.toThrow("notFound");
  expect(decide).not.toHaveBeenCalled();
});

test("the queue shows each question with its key, the validator's answer, its quote and a link", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  open.mockResolvedValueOnce([question]);
  const html = await page();
  expect(html).toContain("What does a candidate need?");
  expect(html).toContain("Flagged");
  expect(html).toMatch(/A majority[^<]*<\/li>/);
  expect(html).toContain("key");
  expect(html).toContain("validator");
  expect(html).toContain("A candidate needs votes from a majority.");
  expect(html).toContain('href="https://pub.test/post#raft"');
  expect(html).toMatch(/<button[^>]*value="keep"/);
  expect(html).toMatch(/<button[^>]*value="retire"/);
  open.mockResolvedValueOnce([]);
  expect(await page()).toContain("Nothing to check");
});

test("Keep or Retire decides the review and says so; bad input changes nothing", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { decideAction } = await import("./actions");
  await expect(
    decideAction(form({ questionId: "42", decision: "retire" })),
  ).rejects.toThrow("redirect:/admin/questions?saved=1");
  expect(decide).toHaveBeenCalledWith("42", "retire", "a1");
  decide.mockResolvedValueOnce(false);
  await expect(
    decideAction(form({ questionId: "42", decision: "keep" })),
  ).rejects.toThrow("redirect:/admin/questions?error=decided");
  vi.clearAllMocks();
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  await expect(
    decideAction(form({ questionId: "x", decision: "keep" })),
  ).rejects.toThrow("notFound");
  await expect(
    decideAction(form({ questionId: "42", decision: "maybe" })),
  ).rejects.toThrow("notFound");
  expect(decide).not.toHaveBeenCalled();
});
