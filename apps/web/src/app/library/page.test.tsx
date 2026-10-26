import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Library, Preferences } from "../../server/ports";

// §4.1, §5I, C-06, Q-P1-19, P1-W5-S05: what you saved and what you finished.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get = vi.fn<(userId: string) => Promise<Preferences | null>>(() =>
  Promise.resolve({
    goals: ["system-design-interviews"],
    topics: ["backend"],
    level: "beginner",
    breakLength: "3-8",
  }),
);
const saves = vi.fn<Library["saves"]>(() => Promise.resolve([]));
const history = vi.fn<Library["history"]>(() => Promise.resolve([]));
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get }),
  library: () => ({ saves, history }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function page(params: Record<string, string> = {}): Promise<string> {
  const { default: LibraryPage } = await import("./page");
  return renderToStaticMarkup(
    await LibraryPage({ searchParams: Promise.resolve(params) }),
  );
}

// Not started, four sections, opens in the browser: the fields a test doesn't care
// about.
const fresh = {
  finishedSections: 0,
  totalSections: 4,
  finished: false,
  nextMomentId: "71",
  frameable: false,
  linkBroken: false,
};

// The words a reader sees, whatever elements carry them.
const text = (html: string) => html.replace(/<[^>]+>/g, "");

test("empty states say so", async () => {
  current.mockResolvedValue(guest);
  const html = await page();
  expect(html).toContain("Nothing saved yet.");
  expect(html).toContain("Nothing here yet.");
  // "History", not "Finished" (owner, 2026-10-26).
  expect(html).toMatch(/<h2[^>]*>History<\/h2>/);
  expect(html).not.toMatch(/<h2[^>]*>Finished<\/h2>/);
  expect(saves).toHaveBeenCalledWith("g1", 50);
  expect(history).toHaveBeenCalledWith("g1", 50);
});

// The link follows the reader (owner, 2026-10-26): Continue reading at the next
// section, Open article when none is done, Read again when finished; in Interval's
// reader when the page can be framed, else the browser.
test("saves and history link by progress, in the reader when the page allows", async () => {
  current.mockResolvedValue(guest);
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
      finishedSections: 2,
      nextMomentId: "103",
    },
  ]);
  history.mockResolvedValueOnce([
    {
      ...fresh,
      itemId: "8",
      articleTitle: "Consensus in practice",
      sourceName: "Other Blog",
      finishedSections: 4,
      finished: true,
      nextMomentId: null,
      frameable: true,
      lastFinishedAt: new Date(),
    },
    {
      ...fresh,
      itemId: "9",
      articleTitle: "Half read",
      sourceName: "Other Blog",
      finishedSections: 2,
      nextMomentId: "93",
      frameable: true,
      lastFinishedAt: new Date(),
    },
  ]);
  const html = await page();
  expect(text(html)).toContain("Raft in practice · Example Engineering");
  // Not started, not framable: the article in a new tab.
  expect(html).toMatch(
    /<a href="\/out\?item=7&amp;from=library&amp;target=original" target="_blank" rel="noopener noreferrer" aria-label="Open article: Raft in practice"[^>]*>Open article<\/a>/,
  );
  // Half read, not framable: its next section in a new tab.
  expect(html).toMatch(
    /<a href="\/out\?item=10&amp;moment=103&amp;from=library&amp;target=section" target="_blank"[^>]*>Continue reading<\/a>/,
  );
  expect(html).toContain("2 of 4 sections");
  // Finished, framable: from the top in the reader, this tab, marked for Back.
  expect(html).toMatch(
    /<a href="\/read\/8\?chip=3-8&amp;from=library" data-read-item="8" aria-label="Read again: Consensus in practice"[^>]*>Read again<\/a>/,
  );
  // Half read, framable: the next section in the reader.
  expect(html).toMatch(
    /<a href="\/read\/9\?moment=93&amp;chip=3-8&amp;from=library" data-read-item="9" data-read-moment="93"[^>]*>Continue reading<\/a>/,
  );
  expect(html).toMatch(/<p[^>]*>Finished<\/p>/);
  expect(html).toMatch(/<input[^>]*name="itemId"[^>]*value="7"/);
  expect(html).toContain("Unsave");
  expect(html).not.toContain("Open original website");
});

// Closing a reader opened here comes back asking (owner, 2026-10-26).
test("ask= opens the finish prompt, which comes back to the Library", async () => {
  current.mockResolvedValue(guest);
  const html = await page({ ask: "9.93" });
  expect(html).toContain("Finished this section?");
  expect(html).toContain('name="back" value="/library"');
  expect(html).toMatch(/name="momentId" value="93"/);
  expect(await page({ ask: "nope" })).not.toContain("Finished this");
});

test("an item whose link broke stays, marked, with no link to follow", async () => {
  current.mockResolvedValue(guest);
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
      finishedSections: 1,
      totalSections: 1,
      finished: true,
      nextMomentId: null,
      lastFinishedAt: new Date(),
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
test("the shelf counts saves; highlights, notes and audio are disabled for later", async () => {
  current.mockResolvedValue(guest);
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
  for (const label of ["Highlights", "Notes", "Audio"]) {
    expect(tile(label)).toContain('aria-disabled="true"');
    expect(text(tile(label))).toContain("Coming later");
  }
});

test("the Library tab is marked current", async () => {
  current.mockResolvedValue(guest);
  const html = await page();
  expect(html).toMatch(
    /<a aria-current="page"[^>]*href="\/library">.*?Library<\/a>/,
  );
  expect(html).toMatch(/href="\/">.*?Home<\/a>/);
});

test("no session goes to /join; not onboarded goes to /onboarding", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
  current.mockResolvedValue(guest);
  get.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("redirect:/onboarding");
});
