import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  BookOutline,
  Books,
  Paths,
  PathSummary,
  PathTimeline,
  Preferences,
} from "../../server/ports";

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
const path = vi.fn<Paths["path"]>(() => Promise.resolve(null));
const list = vi.fn<Books["list"]>(() => Promise.resolve([]));
const outlines = vi.fn<Books["outlines"]>(() => Promise.resolve([]));
const limit = vi.fn(() => Promise.resolve(25));
vi.mock("../../server/container", () => ({
  entitlements: () => ({ limit }),
  sessionReader: () => ({ current }),
  preferences: () => ({ get }),
  paths: () => ({ live, path }),
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

async function page(
  search: { topic?: string; preview?: string } = {},
): Promise<string> {
  const { default: PathsPage } = await import("./page");
  return renderToStaticMarkup(
    await PathsPage({ searchParams: Promise.resolve(search) }),
  );
}

const summary = {
  why: "Why it matters.",
  sections: 3,
  readings: 9,
  minutes: 31,
  topic: null,
  fitsGoal: false,
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

test("with no books and no path, the first visit says what a book is for", async () => {
  current.mockResolvedValue(user);
  expect(await page()).toContain(
    "We split it into short sessions, with a 60-second checkpoint",
  );
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
      chapterId: "90",
      title: "Storage",
      checkpoint: { state: "ready" as const, passed: true },
      sessions: [
        { sessionId: "70", title: "Logs", minutes: 4, finished: true },
      ],
    },
    {
      chapterId: "91",
      title: "Replication",
      checkpoint: null,
      sessions: [
        { sessionId: "71", title: "Leaders", minutes: 5, finished: true },
        { sessionId: "72", title: "Followers", minutes: 6, finished: false },
        { sessionId: "73", title: "Lag", minutes: 3, finished: false },
      ],
    },
    {
      chapterId: "92",
      title: "Partitioning",
      checkpoint: null,
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

// P2-W11-S06 (Q-P2-35): a finished chapter's checkpoint, on its timeline.
test("a finished chapter's checkpoint row says where it stands and leads to its end", async () => {
  current.mockResolvedValue(user);
  const row = async (
    checkpoint: BookOutline["chapters"][number]["checkpoint"],
  ) => {
    list.mockResolvedValueOnce([ready]);
    outlines.mockResolvedValueOnce([
      {
        ...outline,
        chapters: outline.chapters.map((c, i) =>
          i === 0 ? { ...c, checkpoint } : c,
        ),
      },
    ]);
    const html = await page();
    const at = html.indexOf('href="/books/7/checkpoint/90"');
    expect(at).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf("</a>", at));
  };
  expect(await row({ state: "ready", passed: true })).toContain(
    "Checkpoint passed",
  );
  expect(await row({ state: "ready", passed: false })).toContain("Not yet");
  expect(await row({ state: "ready", passed: null })).toContain(
    "Take the checkpoint",
  );
  expect(await row({ state: "preparing", passed: null })).toContain(
    "Preparing",
  );
  expect(await row({ state: "failed", passed: null })).toContain("Try again");
  expect(await row(null)).toContain("Make the checkpoint");
  // An unfinished chapter has no row.
  list.mockResolvedValueOnce([ready]);
  outlines.mockResolvedValueOnce([outline]);
  expect(await page()).not.toContain("/books/7/checkpoint/91");
});

// Wireframe "Web · Paths, first visit": nothing added yet (no book, no path followed).
const fresh: PathSummary[] = [
  {
    ...summary,
    pathId: "6",
    name: "Caching",
    mine: null,
    retired: false,
    topic: "system-design",
    fitsGoal: true,
  },
  {
    ...summary,
    pathId: "7",
    name: "Indexes",
    mine: null,
    retired: false,
    topic: "databases",
  },
];

test("a first visit offers a PDF upload and the ready-made paths", async () => {
  current.mockResolvedValue(user);
  live.mockResolvedValueOnce(fresh);
  const html = await page();
  expect(html).toContain("Bring your own reading");
  expect(html).toContain('action="/api/books"');
  expect(html).toContain('accept="application/pdf,.pdf"');
  expect(html).not.toContain("EPUB");
  // The honest notice (Q-P2-38), not the wireframe's "nothing is shared".
  expect(html).toContain("Checkpoints send a chapter&#x27;s text to our");
  expect(html).not.toContain("nothing is shared");
  expect(html).toContain("Or start a ready-made path");
  expect(html).toContain("How a path works");
  expect(html).toContain("Your plan shows up here");
  // "Fits your goal" only on the path that overlaps the user's goal concepts.
  const caching = html.slice(
    html.indexOf(">Caching<"),
    html.indexOf(">Indexes<"),
  );
  expect(caching).toContain("Fits your goal");
  expect(html.slice(html.indexOf(">Indexes<"))).not.toContain("Fits your goal");
});

test("a guest's first visit asks for an account instead of an upload", async () => {
  current.mockResolvedValue({ ...user, isGuest: true });
  live.mockResolvedValueOnce(fresh);
  const html = await page();
  expect(html).toContain("Create an account to add a book");
  expect(html).not.toContain('action="/api/books"');
});

test("topic chips filter the paths; an unknown topic shows them all", async () => {
  current.mockResolvedValue(user);
  live.mockResolvedValue(fresh);
  const all = await page();
  expect(all).toContain('href="/paths?topic=system-design"');
  expect(all).toContain('href="/paths?topic=databases"');
  const databases = await page({ topic: "databases" });
  expect(databases).toContain(">Indexes<");
  expect(databases).not.toContain(">Caching<");
  expect(databases).toMatch(/aria-current="true"[^>]*>#databases</);
  const unknown = await page({ topic: "cooking" });
  expect(unknown).toContain(">Caching<");
  expect(unknown).toContain(">Indexes<");
  live.mockReset();
  live.mockResolvedValue([]);
});

test("picking a path previews its sections on the right, to start it", async () => {
  current.mockResolvedValue(user);
  live.mockResolvedValueOnce(fresh);
  path.mockResolvedValueOnce({
    pathId: "6",
    name: "Caching",
    why: "Speed things up.",
    retired: false,
    mine: null,
    sections: [
      {
        sectionId: "61",
        concepts: ["Caching", "CDN"],
        readings: [
          {
            momentId: "601",
            itemId: "60",
            sectionTitle: "Cache-aside",
            articleTitle: "Caching patterns",
            sourceName: "Example Engineering",
            minutes: 4,
            frameable: false,
            linkBroken: false,
            finished: false,
            ordinal: 0,
          },
        ],
        open: true,
        checkpoint: "locked",
        skipped: false,
        warning: null,
        holdsBack: false,
        mastered: false,
        foundations: [],
        size: 0,
        passMark: 0,
      },
    ],
  } satisfies PathTimeline);
  const html = await page({ preview: "6" });
  expect(path).toHaveBeenCalledWith("u1", "6");
  expect(html).toContain("Speed things up.");
  expect(html).toContain("Caching, CDN");
  expect(html).toMatch(/name="pathId" value="6"[^]*?Start this path/);
  expect(html).not.toContain("Your plan shows up here");
  // Owner, 2026-10-29: the path opens in a pane on the right with its readings; the
  // upload steps aside, the list is one column, and the picked card is marked.
  expect(html).toContain("Cache-aside · Example Engineering · 4 min");
  expect(html).not.toContain("Bring your own reading");
  expect(html).not.toContain("sm:grid-cols-2");
  expect(html).toContain('href="/paths?preview=6#path-6"');
  expect(html).toMatch(
    /aria-current="true"[^>]*href="\/paths\?preview=6#path-6"|href="\/paths\?preview=6#path-6"[^>]*aria-current="true"/,
  );
  // Each side scrolls on its own; the other path dims until the list is hovered.
  expect(html.match(/[\s"](lg:)?overflow-y-auto/g)).toHaveLength(2);
  // On a phone the path is a sheet over the list; on a wide screen, the side pane.
  expect(html).toMatch(/<aside[^>]*class="fixed inset-0[^"]*lg:static/);
  expect(html).toContain("lg:-mr-6 lg:-ml-1 lg:overflow-y-auto");
  const other = html.slice(html.indexOf('id="path-7"'));
  expect(other.slice(0, 300)).toContain("lg:opacity-40 lg:grayscale");
  expect(html.slice(html.indexOf('id="path-6"')).slice(0, 120)).not.toContain(
    "opacity-40",
  );
  expect(html).toContain('aria-label="Close the path"');
});

test("a bad preview id shows the empty plan card", async () => {
  current.mockResolvedValue(user);
  live.mockResolvedValueOnce(fresh);
  const html = await page({ preview: "not-an-id" });
  expect(path).not.toHaveBeenCalled();
  expect(html).toContain("Your plan shows up here");
});

test("the upload says the rules before it starts: rights, size and DRM", async () => {
  current.mockResolvedValue(user);
  live.mockResolvedValueOnce(fresh);
  const html = await page();
  expect(html).toContain("allowed to use, up to 25 MB");
  expect(html).toContain("protected (DRM)");
});

test("a preview the user can't see, or a retired path, offers no Start", async () => {
  current.mockResolvedValue(user);
  live.mockResolvedValueOnce(fresh);
  path.mockResolvedValueOnce(null); // a draft or unknown path
  expect(await page({ preview: "99" })).toContain("Your plan shows up here");
  live.mockResolvedValueOnce(fresh);
  path.mockResolvedValueOnce({
    pathId: "6",
    name: "Caching",
    why: "Old.",
    retired: true,
    mine: null,
    sections: [],
  });
  expect(await page({ preview: "6" })).not.toContain("Start this path");
});

test("no books but a followed path keeps the regular page and the book prompt", async () => {
  current.mockResolvedValue(user);
  live.mockResolvedValueOnce([
    {
      ...summary,
      pathId: "6",
      name: "Caching",
      mine: "paused",
      retired: false,
    },
  ]);
  const html = await page();
  expect(html).not.toContain("Bring your own reading");
  expect(html).toContain("Upload a PDF to read it in short sessions.");
});
