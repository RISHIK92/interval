import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Library,
  Listening,
  NoteEntry,
  Notes,
  Preferences,
  Quizzes,
} from "../../server/ports";

// §4.1, §5I, C-06, Q-P1-19, P1-W5-S05: what you saved and what you read. ADR-0058: an
// article's state is all it says of how far.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get = vi.fn<(userId: string) => Promise<Preferences | null>>(() =>
  Promise.resolve({
    goals: ["system-design-interviews"],
    topics: ["backend"],
    level: "beginner",
    firstName: null,
  }),
);
const saves = vi.fn<Library["saves"]>(() => Promise.resolve([]));
const history = vi.fn<Library["history"]>(() => Promise.resolve([]));
const list = vi.fn<Notes["list"]>(() => Promise.resolve([]));
const dueReviews = vi.fn<Quizzes["dueReviews"]>(() => Promise.resolve([]));
const queue = vi.fn<Listening["queue"]>(() =>
  Promise.resolve({ queue: [], upNext: null }),
);
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get }),
  library: () => ({ saves, history }),
  notes: () => ({ list }),
  quizzes: () => ({ dueReviews }),
  listening: () => ({ queue }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const user: Actor = { userId: "g1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function page(params: Record<string, string> = {}): Promise<string> {
  const { default: LibraryPage } = await import("./page");
  return renderToStaticMarkup(
    await LibraryPage({ searchParams: Promise.resolve(params) }),
  );
}

// Unread, opens in the browser: the fields a test doesn't care about.
const fresh = {
  state: "unread" as const,
  frameable: false,
  linkBroken: false,
};

// The words a reader sees, whatever elements carry them.
const text = (html: string) => html.replace(/<[^>]+>/g, "");

test("empty states say so", async () => {
  current.mockResolvedValue(user);
  const html = await page();
  expect(html).toContain("Nothing saved yet.");
  expect(html).toContain("Nothing here yet.");
  // "History", not "Finished" (owner, 2026-10-26).
  expect(html).toMatch(/<h2[^>]*>History<\/h2>/);
  expect(html).not.toMatch(/<h2[^>]*>Finished<\/h2>/);
  expect(saves).toHaveBeenCalledWith("g1", 50);
  expect(history).toHaveBeenCalledWith("g1", 50);
});

// The link follows the article's state (ADR-0058): Open article when unread, Continue
// reading when opened, Read again when completed; in Interval's reader when the page
// can be framed, else the browser.
test("saves and history link by state, in the reader when the page allows", async () => {
  current.mockResolvedValue(user);
  saves.mockResolvedValueOnce([
    {
      ...fresh,
      itemId: "7",
      articleTitle: "Raft in practice",
      sourceName: "Example Engineering",
      savedAt: new Date(),
    },
    {
      ...fresh,
      itemId: "10",
      articleTitle: "Paxos made plain",
      sourceName: "Example Engineering",
      savedAt: new Date(),
      state: "continue_reading",
    },
  ]);
  history.mockResolvedValueOnce([
    {
      ...fresh,
      itemId: "8",
      articleTitle: "Consensus in practice",
      sourceName: "Other Blog",
      state: "completed",
      frameable: true,
      lastReadAt: new Date(),
    },
    {
      ...fresh,
      itemId: "9",
      articleTitle: "Half read",
      sourceName: "Other Blog",
      state: "continue_reading",
      frameable: true,
      lastReadAt: new Date(),
    },
  ]);
  const html = await page();
  expect(text(html)).toContain("Raft in practice · Example Engineering");
  // Unread, not framable: the article in a new tab.
  expect(html).toMatch(
    /<a href="\/out\?item=7&amp;from=library&amp;target=original" data-item="7" target="_blank" rel="noopener noreferrer" aria-label="Open article: Raft in practice"[^>]*>Open article<\/a>/,
  );
  // Opened, not framable: the article again, in a new tab, marked so coming back to
  // this tab asks, as on Home (owner, 2026-10-26).
  expect(html).toMatch(
    /<a href="\/out\?item=10&amp;from=library&amp;target=original" data-item="10" target="_blank"[^>]*>Continue reading<\/a>/,
  );
  // Completed, framable: in the reader, this tab, marked for Back.
  expect(html).toMatch(
    /<a href="\/read\/8\?from=library" data-read-item="8" aria-label="Read again: Consensus in practice"[^>]*>Read again<\/a>/,
  );
  expect(html).toMatch(
    /<a href="\/read\/9\?from=library" data-read-item="9"[^>]*>Continue reading<\/a>/,
  );
  expect(html.match(/<p[^>]*>Completed<\/p>/g)).toHaveLength(1);
  expect(html).not.toContain("sections");
  expect(html).toMatch(/<input[^>]*name="itemId"[^>]*value="7"/);
  expect(html).toContain("Unsave");
  expect(html).not.toContain("Open original website");
});

// Closing a reader opened here comes back asking (owner, 2026-10-26).
test("ask= opens the finish prompt, which comes back to the Library", async () => {
  current.mockResolvedValue(user);
  const html = await page({ ask: "9" });
  expect(html).toContain('name="back" value="/library"');
  expect(html).toMatch(/name="itemId" value="9"/);
  expect(html).not.toContain("momentId");
  expect(await page({ ask: "nope" })).not.toMatch(/name="itemId" value=/);
});

test("an item whose link broke stays, marked, with no link to follow", async () => {
  current.mockResolvedValue(user);
  saves.mockResolvedValueOnce([
    {
      ...fresh,
      itemId: "7",
      articleTitle: "Gone post",
      sourceName: "Example Engineering",
      savedAt: new Date(),
      linkBroken: true,
    },
  ]);
  history.mockResolvedValueOnce([
    {
      ...fresh,
      itemId: "8",
      articleTitle: "Gone too",
      sourceName: "Other Blog",
      state: "completed",
      lastReadAt: new Date(),
      linkBroken: true,
    },
  ]);
  const html = await page();
  expect(text(html)).toContain("Gone post · Example Engineering");
  expect(text(html)).toContain("Gone too · Other Blog");
  expect(html.match(/Link broken/g)).toHaveLength(2);
  expect(html).not.toContain("item=7");
  expect(html).not.toContain("item=8");
  expect(html).not.toContain("/read/");
  expect(html).toContain("Unsave"); // it can still be removed
});

// Highlights, notes and audio arrive in later phases (owner, 2026-10-26).
test("the shelf counts saves and notes; highlights and audio are disabled for later", async () => {
  current.mockResolvedValue(user);
  saves.mockResolvedValueOnce([
    {
      ...fresh,
      itemId: "7",
      articleTitle: "Raft in practice",
      sourceName: "Example Engineering",
      savedAt: new Date(),
    },
  ]);
  const html = await page();
  const tile = (label: string) =>
    new RegExp(`<div role="group" aria-label="${label}"[^>]*>.*?</div>`).exec(
      html,
    )?.[0] ?? "";
  expect(text(tile("Saved"))).toBe("Saved1");
  expect(tile("Saved")).not.toContain("aria-disabled");
  expect(text(tile("Notes"))).toBe("Notes0");
  expect(tile("Notes")).not.toContain("aria-disabled");
  expect(tile("Highlights")).toContain('aria-disabled="true"');
  expect(text(tile("Highlights"))).toContain("Coming later");
});

// P4-W23-S01 (§5I): the audio queue, counted on the shelf and listed with its controls.
test("the audio queue lists each queued explainer with Play and Remove", async () => {
  current.mockResolvedValue(user);
  const raft = {
    explainerId: "7",
    conceptId: "3",
    concept: "Raft",
    src: "/media/explainers/3/7/r/index.m3u8",
    durationSeconds: 95,
    positionSeconds: 30,
    sources: [],
    captions: [],
    scene: null,
  };
  queue.mockResolvedValueOnce({ queue: [raft], upNext: null });
  const html = await page();
  expect(html).toMatch(
    /<a href="#audio-queue" aria-label="Audio"[^>]*>.*?>1<\/span><\/a>/,
  );
  expect(html).toContain('id="audio-queue"');
  expect(text(html)).toContain("RaftAI explainer · 1:35 · at 0:30");
  expect(html).toContain('aria-label="Play Raft"');
  expect(html).toContain('aria-label="Remove Raft"');
});

test("an empty audio queue says where it fills from", async () => {
  current.mockResolvedValue(user);
  const html = await page();
  expect(text(html)).toContain("Nothing queued. Listen in the reader");
});

test("the Library tab is marked current", async () => {
  current.mockResolvedValue(user);
  const html = await page();
  expect(html).toMatch(
    /<a aria-current="page"[^>]*href="\/library">.*?Library<\/a>/,
  );
  expect(html).toMatch(/href="\/">.*?Home<\/a>/);
});

test("no session goes to /join; not onboarded goes to /onboarding", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
  current.mockResolvedValue(user);
  get.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("redirect:/onboarding");
});

// P2-W7-S04 (§5I, Q-P2-01): the Notes section, each note back to its article.
test("Notes lists each note with its article and an edit by its id", async () => {
  current.mockResolvedValue(user);
  const note: NoteEntry = {
    noteId: "42",
    itemId: "70",
    articleTitle: "Consensus in practice",
    sourceName: "Example Engineering",
    body: "Terms are epochs",
    frameable: true,
    linkBroken: false,
  };
  list.mockResolvedValueOnce([note, { ...note, noteId: "43", body: "Older" }]);
  const html = await page();
  const notes = html.slice(html.indexOf('aria-label="Notes"><h2'));
  expect(text(notes)).toContain("Consensus in practice · Example Engineering");
  expect(text(notes)).toContain("Terms are epochs");
  expect(text(notes)).toContain("Older");
  expect(notes.match(/href="\/read\/70\?from=library"/g)).toHaveLength(2);
  expect(notes).toMatch(/<input[^>]*name="noteId"[^>]*value="43"/);
  expect(notes).toMatch(/<button[^>]*value="delete"/);
  // The Notes tile is no longer "Coming later".
  expect(html).toMatch(
    /aria-label="Notes"[^>]*>(?:(?!aria-disabled).)*?<span class="text-numbers">2<\/span>/s,
  );
});

test("no notes yet says how to start", async () => {
  current.mockResolvedValue(user);
  expect(text(await page())).toContain(
    "No notes yet. Add one from the note icon while you read.",
  );
});

test("note links follow the page: the browser when it can't be framed, or Link broken", async () => {
  current.mockResolvedValue(user);
  const note: NoteEntry = {
    noteId: "42",
    itemId: "70",
    articleTitle: "Consensus in practice",
    sourceName: "Example Engineering",
    body: "Terms are epochs",
    frameable: false,
    linkBroken: false,
  };
  list.mockResolvedValueOnce([
    note,
    { ...note, noteId: "43" },
    { ...note, noteId: "44", linkBroken: true },
  ]);
  const html = await page();
  const notes = html.slice(html.indexOf('aria-label="Notes"><h2'));
  expect(notes).toContain(
    'href="/out?item=70&amp;from=library&amp;target=original"',
  );
  expect(text(notes)).toContain("Link broken");
  // Each row's controls are named by what the note is on (screen readers).
  expect(notes).toContain('aria-label="Open article: Consensus in practice"');
  expect(notes).toContain('aria-label="Note on Consensus in practice"');
});

// P2-W9-S05 (Q-P2-17, wireframe 08): the review queue is the top card.
test("the review queue comes first, with the count, the concepts and a time", async () => {
  current.mockResolvedValue(user);
  dueReviews.mockResolvedValueOnce([
    { conceptId: "1", name: "Raft", daysSince: 2 },
    { conceptId: "2", name: "Quorum", daysSince: 3 },
    { conceptId: "3", name: "Write-ahead log", daysSince: 4 },
    { conceptId: "4", name: "MVCC", daysSince: 5 },
  ]);
  const html = await page();
  expect(dueReviews).toHaveBeenCalledWith("g1");
  const words = text(html);
  expect(words.indexOf("Review queue")).toBeLessThan(
    words.indexOf("Everything you kept"),
  );
  expect(words).toContain("4 concepts due · about 2 min");
  expect(words).toMatch(/Raft[^]*Quorum[^]*Write-ahead log[^]*MVCC/);
  expect(html).toMatch(/<form[^>]*>(?:(?!<\/form>)[^])*Start review/);
});

test("with nothing due, the queue says so and offers no review", async () => {
  current.mockResolvedValue(user);
  const words = text(await page());
  expect(words).toContain("Nothing due for review.");
  expect(words).not.toContain("Start review");
});
