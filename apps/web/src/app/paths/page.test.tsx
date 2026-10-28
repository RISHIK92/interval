import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Books, Paths, Preferences } from "../../server/ports";

// §4, §5F, Q-P2-27 (P2-W10-S03): the Paths tab lists live paths.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get = vi.fn<(userId: string) => Promise<Preferences | null>>(() =>
  Promise.resolve({
    goals: [],
    topics: ["backend"],
    level: "beginner",
    breakLength: "3-8",
    firstName: null,
  }),
);
const live = vi.fn<Paths["live"]>(() => Promise.resolve([]));
const list = vi.fn<Books["list"]>(() => Promise.resolve([]));
const outlines = vi.fn<Books["outlines"]>(() => Promise.resolve([]));
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get }),
  paths: () => ({ live }),
  books: () => ({ list, outlines }),
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

afterEach(() => {
  vi.clearAllMocks();
});

async function page(): Promise<string> {
  const { default: PathsPage } = await import("./page");
  return renderToStaticMarkup(await PathsPage());
}

const summary = {
  why: "Why it matters.",
  sections: 3,
  readings: 9,
  minutes: 31,
};

test("the active path comes first to continue; the others can be started or resumed", async () => {
  current.mockResolvedValue(user);
  live.mockResolvedValueOnce([
    { ...summary, pathId: "6", name: "Caching", mine: null, retired: false },
    {
      ...summary,
      pathId: "7",
      name: "Replication",
      mine: "active",
      retired: false,
    },
    {
      ...summary,
      pathId: "8",
      name: "Indexes",
      mine: "paused",
      retired: false,
    },
    {
      ...summary,
      pathId: "9",
      name: "Old path",
      mine: "paused",
      retired: true,
    },
  ]);
  const html = await page();
  expect(live).toHaveBeenCalledWith("u1");
  expect(html.indexOf("Replication")).toBeLessThan(html.indexOf("Caching"));
  expect(html).toContain('href="/paths/7"');
  expect(html).toContain("Continue");
  expect(html).toContain("3 sections · 9 readings · about 31 min");
  expect(html).toMatch(/name="pathId" value="6"[^]*?Start/);
  expect(html).toMatch(/name="pathId" value="8"[^]*?Resume/);
  // A retired path the user followed: marked, readable, never resumed.
  const old = html.slice(html.indexOf("Old path"));
  expect(old).toContain("Retired");
  expect(old).not.toContain('name="pathId" value="9"');
  expect(old).toContain('href="/paths/9"');
  // Paths is the current tab.
  expect(html).toMatch(
    /<a(?=[^>]*href="\/paths")(?=[^>]*aria-current="page")[^>]*>/,
  );
});

test("with no live paths, it says so", async () => {
  current.mockResolvedValue(user);
  expect(await page()).toContain("No paths yet");
});

test("signed out goes to join; not onboarded goes to onboarding", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
  current.mockResolvedValue(user);
  get.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("redirect:/onboarding");
});

// P2-W11-S01: the user's private PDF books.
test("Your books lists the user's books with their status, and Add a book", async () => {
  current.mockResolvedValue(user);
  list.mockResolvedValueOnce([
    {
      bookId: "3",
      title: "Designing Data-Intensive Applications",
      status: "processing",
      failure: null,
      createdAt: new Date(),
    },
    {
      bookId: "2",
      title: "Scanned notes",
      status: "failed",
      failure: "protected PDFs can't be read",
      createdAt: new Date(),
    },
  ]);
  const html = await page();
  expect(list).toHaveBeenCalledWith("u1");
  expect(html).toContain('href="/books/new"');
  expect(html).toMatch(/Designing Data-Intensive Applications[^]*?Processing/);
  expect(html).toContain(
    "Couldn&#x27;t be read: protected PDFs can&#x27;t be read",
  );
  // Delete asks first.
  expect(html).toMatch(/popover[tT]arget="delete-book-3"/);
  expect(html).toMatch(/name="bookId" value="3"[^]*?Delete book/);
});

test("with no books, it says what a book is for", async () => {
  current.mockResolvedValue(user);
  expect(await page()).toContain("Upload a PDF to read it in short sessions.");
});

// P2-W11-S05 (§5F, Q-P2-33): a ready book is followed like a path.
const ready = {
  bookId: "7",
  title: "Designing Data Systems",
  status: "ready" as const,
  failure: null,
  createdAt: new Date(),
};
const outline = {
  bookId: "7",
  title: "Designing Data Systems",
  done: 2,
  of: 5,
  first: "70",
  started: true,
  next: "72",
  chapters: [
    {
      title: "Storage",
      sessions: [
        { sessionId: "70", title: "Logs", minutes: 4, finished: true },
      ],
    },
    {
      title: "Replication",
      sessions: [
        { sessionId: "71", title: "Leaders", minutes: 5, finished: true },
        { sessionId: "72", title: "Followers", minutes: 6, finished: false },
        { sessionId: "73", title: "Lag", minutes: 3, finished: false },
      ],
    },
    {
      title: "Partitioning",
      sessions: [
        { sessionId: "74", title: "Keys", minutes: 4, finished: false },
      ],
    },
  ],
};

test("a ready book shows its progress and a chapter timeline, the next session to resume", async () => {
  current.mockResolvedValue(user);
  list.mockResolvedValueOnce([ready]);
  outlines.mockResolvedValueOnce([outline]);
  const html = await page();
  expect(outlines).toHaveBeenCalledWith("u1");
  expect(html).toContain("Your PDF · 2 of 5 sessions");
  expect(html).toMatch(
    /role="progressbar"[^>]*aria-valuenow="2"[^>]*aria-valuemax="5"/,
  );
  // Finished chapters ticked with a count; the current one open, its sessions ticked.
  expect(html).toMatch(/Finished: <\/span>Storage[^]*?1 session\b/);
  expect(html).toMatch(/Reading now: <\/span>Replication/);
  expect(html).toMatch(
    /Finished: <\/span>Leaders[^]*?Up next: <\/span>Followers/,
  );
  expect(html).toContain('href="/books/7?session=72"');
  expect(html).toMatch(/Resume<\/a>/);
  expect(html).toContain("Lag");
  // A later chapter shows only its count.
  expect(html).toMatch(/Partitioning[^]*?1 session\b/);
  expect(html).not.toContain("Keys");
});

test("a book not started says Start; a finished one offers to read it again", async () => {
  current.mockResolvedValue(user);
  list.mockResolvedValue([ready]);
  outlines.mockResolvedValueOnce([
    {
      ...outline,
      done: 0,
      started: false,
      next: "70",
      chapters: outline.chapters.map((c) => ({
        ...c,
        sessions: c.sessions.map((x) => ({ ...x, finished: false })),
      })),
    },
  ]);
  expect(await page()).toMatch(/href="\/books\/7\?session=70"[^>]*>Start<\/a>/);
  // A place saved, nothing finished yet: Resume.
  outlines.mockResolvedValueOnce([
    { ...outline, done: 0, started: true, next: "70" },
  ]);
  expect(await page()).toMatch(
    /href="\/books\/7\?session=70"[^>]*>Resume<\/a>/,
  );
  outlines.mockResolvedValueOnce([{ ...outline, done: 5, next: null }]);
  const html = await page();
  expect(html).toContain("Finished");
  expect(html).toMatch(/href="\/books\/7\?session=70"[^>]*>Read again<\/a>/);
  list.mockReset();
});
