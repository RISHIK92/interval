import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Paths, Preferences } from "../../server/ports";

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
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get }),
  paths: () => ({ live }),
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
