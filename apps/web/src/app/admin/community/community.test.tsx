import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AdminCommunity,
  CommunityReview,
} from "../../../server/ports";

// Q-P7-05 (owner, 2026-11-27): the owner's queue of community questions the second
// model agreed with; the page and its action exist only for admin.review.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const open = vi.fn<AdminCommunity["open"]>(() => Promise.resolve([]));
const decide = vi.fn<AdminCommunity["decide"]>(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminCommunity: () => ({ open, decide }),
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

const review: CommunityReview = {
  questionId: "42",
  stem: "What does a Raft leader need to commit an entry?",
  options: ["Every vote", "A majority", "The longest log", "A lease"],
  correct: 1,
  validatorAnswer: 1,
  citation: "an entry is committed once a majority has it",
  articleTitle: "Consensus in practice",
  sectionTitle: "Raft",
  link: "https://pub.test/post#raft",
  author: "ada_l",
  submittedAt: new Date("2026-11-27T10:00:00Z"),
};

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: CommunityPage } = await import("./page");
  return renderToStaticMarkup(
    await CommunityPage({ searchParams: Promise.resolve(query) }),
  );
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("only admin.review holders see the queue or can decide", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  const { decideCommunityAction } = await import("./actions");
  await expect(
    decideCommunityAction(form({ questionId: "42", decision: "approve" })),
  ).rejects.toThrow("notFound");
  expect(decide).not.toHaveBeenCalled();
});

test("each question with its key, the validator's answer, its quote, its section and its author", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  open.mockResolvedValueOnce([review]);
  const html = await page();
  expect(html).toContain("What does a Raft leader need to commit an entry?");
  expect(html).toMatch(/A majority \(key\) \(validator\)<\/li>/);
  expect(html).toContain("an entry is committed once a majority has it");
  expect(html).toContain('href="https://pub.test/post#raft"');
  expect(html).toContain("Raft — Consensus in practice");
  expect(html).toContain("@ada_l");
  expect(html).toMatch(/<button[^>]*value="approve"/);
  expect(html).toMatch(/<button[^>]*value="reject"/);
  open.mockResolvedValueOnce([{ ...review, author: null }]);
  expect(await page()).toContain("No username, or the author left");
  expect(await page()).toContain("Nothing to review.");
});

test("Approve or Reject decides it and says so; bad input changes nothing", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { decideCommunityAction } = await import("./actions");
  await expect(
    decideCommunityAction(form({ questionId: "42", decision: "approve" })),
  ).rejects.toThrow("redirect:/admin/community?saved=approve");
  expect(decide).toHaveBeenCalledWith("42", "approve", "a1");
  decide.mockResolvedValueOnce(false);
  await expect(
    decideCommunityAction(form({ questionId: "42", decision: "reject" })),
  ).rejects.toThrow("redirect:/admin/community?error=decided");
  decide.mockClear();
  await expect(
    decideCommunityAction(form({ questionId: "x", decision: "approve" })),
  ).rejects.toThrow("notFound");
  await expect(
    decideCommunityAction(form({ questionId: "42", decision: "keep" })),
  ).rejects.toThrow("notFound");
  expect(decide).not.toHaveBeenCalled();
  expect(await page({ saved: "approve" })).toContain(
    "Approved. It&#x27;s live; practice will ask it",
  );
  expect(await page({ error: "decided" })).toContain(
    "That question was already decided.",
  );
});
