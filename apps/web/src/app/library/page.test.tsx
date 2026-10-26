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

async function page(): Promise<string> {
  const { default: LibraryPage } = await import("./page");
  return renderToStaticMarkup(await LibraryPage());
}

// The words a reader sees, whatever elements carry them.
const text = (html: string) => html.replace(/<[^>]+>/g, "");

test("empty states say so", async () => {
  current.mockResolvedValue(guest);
  const html = await page();
  expect(html).toContain("Nothing saved yet.");
  expect(html).toContain("Nothing finished yet.");
  expect(saves).toHaveBeenCalledWith("g1", 50);
  expect(history).toHaveBeenCalledWith("g1", 50);
});

test("saves and finished articles are listed with their links", async () => {
  current.mockResolvedValue(guest);
  saves.mockResolvedValueOnce([
    {
      itemId: "7",
      articleTitle: "Raft in practice",
      sourceName: "Example Engineering",
      savedAt: new Date(),
      linkBroken: false,
    },
  ]);
  history.mockResolvedValueOnce([
    {
      itemId: "8",
      articleTitle: "Consensus in practice",
      sourceName: "Other Blog",
      finishedSections: 4,
      totalSections: 4,
      finished: true,
      lastFinishedAt: new Date(),
      linkBroken: false,
    },
    {
      itemId: "9",
      articleTitle: "Half read",
      sourceName: "Other Blog",
      finishedSections: 2,
      totalSections: 4,
      finished: false,
      lastFinishedAt: new Date(),
      linkBroken: false,
    },
  ]);
  const html = await page();
  expect(text(html)).toContain("Raft in practice · Example Engineering");
  expect(html).toContain(
    'href="/out?item=7&amp;from=library&amp;target=original"',
  );
  expect(html).toMatch(/<input[^>]*name="itemId"[^>]*value="7"/);
  expect(html).toContain("Unsave");
  expect(text(html)).toContain("Consensus in practice · Other Blog");
  expect(html).toMatch(/<p[^>]*>Finished<\/p>/);
  expect(html).not.toContain("4 of 4 sections");
  expect(html).toContain("2 of 4 sections");
  expect(html).toContain(
    'href="/out?item=8&amp;from=library&amp;target=original"',
  );
  expect(html).toContain(
    'aria-label="Open Raft in practice on the original website"',
  );
  expect(html).not.toContain("Nothing saved yet.");
});

test("an item whose link broke stays, marked, with no link to follow", async () => {
  current.mockResolvedValue(guest);
  saves.mockResolvedValueOnce([
    {
      itemId: "7",
      articleTitle: "Gone post",
      sourceName: "Example Engineering",
      savedAt: new Date(),
      linkBroken: true,
    },
  ]);
  history.mockResolvedValueOnce([
    {
      itemId: "8",
      articleTitle: "Gone too",
      sourceName: "Other Blog",
      finishedSections: 1,
      totalSections: 1,
      finished: true,
      lastFinishedAt: new Date(),
      linkBroken: true,
    },
  ]);
  const html = await page();
  expect(text(html)).toContain("Gone post · Example Engineering");
  expect(text(html)).toContain("Gone too · Other Blog");
  expect(html.match(/Link broken/g)).toHaveLength(2);
  expect(html).not.toContain("/out?item=7");
  expect(html).not.toContain("/out?item=8");
  expect(html).toContain("Unsave"); // it can still be removed
});

// Highlights, notes and audio arrive in later phases (owner, 2026-10-26).
test("the shelf counts saves; highlights, notes and audio are disabled for later", async () => {
  current.mockResolvedValue(guest);
  saves.mockResolvedValueOnce([
    {
      itemId: "7",
      articleTitle: "Raft in practice",
      sourceName: "Example Engineering",
      savedAt: new Date(),
      linkBroken: false,
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
