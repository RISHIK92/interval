import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Books, ChapterEnd } from "../../../../../server/ports";

// P2-W11-S06 (§5F, Q-P2-35): a chapter's end, where its checkpoint is made and taken.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const checkpoint = vi.fn<Books["checkpoint"]>();
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({
    get: () =>
      Promise.resolve({
        goals: [],
        topics: ["backend"],
        level: "beginner",
        breakLength: "3-8",
        firstName: null,
      }),
  }),
  books: () => ({ checkpoint }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const end: ChapterEnd = {
  bookId: "7",
  bookTitle: "Designing Data Systems",
  chapterId: "9",
  title: "Replication",
  finished: true,
  state: "ready",
  stuck: false,
  failure: null,
  size: 5,
  concepts: ["Leader election", "Quorums"],
  last: null,
  next: { sessionId: "80", title: "Partitioning 1" },
};

afterEach(() => {
  vi.clearAllMocks();
});

async function page(id = "7", chapter = "9"): Promise<string> {
  const { default: ChapterEndPage } = await import("./page");
  return renderToStaticMarkup(
    await ChapterEndPage({ params: Promise.resolve({ id, chapter }) }),
  );
}

test("ready: what it asks and what passing takes, then the way on", async () => {
  current.mockResolvedValue(user);
  checkpoint.mockResolvedValueOnce(end);
  const html = await page();
  expect(checkpoint).toHaveBeenCalledWith("u1", "9");
  expect(html).toContain("Replication");
  expect(html).toContain("60 seconds · 5 questions · pass 4 of 5");
  expect(html).toContain("Leader election, Quorums");
  expect(html).toMatch(
    /name="chapterId" value="9"[^]*?name="back" value="\/books\/7\/checkpoint\/9"[^]*?Take the checkpoint/,
  );
  expect(html).toContain('href="/books/7?session=80"');
  expect(html).toContain("Partitioning 1");
});

test("preparing: it says so and keeps checking; stuck, it can be asked again", async () => {
  current.mockResolvedValue(user);
  checkpoint.mockResolvedValueOnce({ ...end, state: "preparing", size: 0 });
  let html = await page();
  expect(html).toContain("Preparing your checkpoint…");
  expect(html).toContain('role="status"');
  expect(html).not.toContain("Try again");
  checkpoint.mockResolvedValueOnce({
    ...end,
    state: "preparing",
    stuck: true,
    size: 0,
  });
  html = await page();
  expect(html).toMatch(/name="chapterId" value="9"[^]*?Try again/);
});

test("failed: the reason and Try again; not made yet: Make the checkpoint", async () => {
  current.mockResolvedValue(user);
  checkpoint.mockResolvedValueOnce({
    ...end,
    state: "failed",
    failure: "Today's AI budget is used up. Try again tomorrow.",
    size: 0,
  });
  let html = await page();
  expect(html).toContain("Today&#x27;s AI budget is used up.");
  expect(html).toMatch(/name="bookId" value="7"[^]*?Try again/);
  checkpoint.mockResolvedValueOnce({ ...end, state: "none", size: 0 });
  html = await page();
  expect(html).toContain("Make the checkpoint");
  // A chapter not finished: read it first.
  checkpoint.mockResolvedValueOnce({
    ...end,
    state: "none",
    finished: false,
    size: 0,
  });
  html = await page();
  expect(html).toContain("Finish this chapter");
  expect(html).not.toContain("Make the checkpoint");
});

test("taken: the last result, and it can be taken again", async () => {
  current.mockResolvedValue(user);
  checkpoint.mockResolvedValueOnce({
    ...end,
    last: { passed: true, correct: 4, size: 5 },
  });
  let html = await page();
  expect(html).toContain("Passed 4 of 5");
  expect(html).toContain("Take it again");
  checkpoint.mockResolvedValueOnce({
    ...end,
    last: { passed: false, correct: 2, size: 5 },
  });
  html = await page();
  expect(html).toContain("Not yet: 2 of 5");
});

test("someone else's chapter, or a bad id, is not found", async () => {
  current.mockResolvedValue(user);
  checkpoint.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("notFound");
  await expect(page("7", "x")).rejects.toThrow("notFound");
  checkpoint.mockResolvedValueOnce({ ...end, bookId: "8" });
  await expect(page()).rejects.toThrow("notFound");
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
});
