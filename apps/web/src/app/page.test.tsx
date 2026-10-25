import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, FeedCard } from "../server/ports";

const getFeed = vi.fn<(limit: number) => Promise<FeedCard[]>>();
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
vi.mock("../server/container", () => ({
  feedReader: () => ({ list: getFeed }),
  sessionReader: () => ({ current }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const guest: Actor = { userId: "u1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  getFeed.mockReset();
  current.mockReset();
});

const card: FeedCard = {
  momentId: "1",
  sectionTitle: "Why consensus",
  sectionNumber: 1,
  sectionCount: 2,
  estimatedMinutes: 2,
  link: "https://webfeed.example.test/post",
  articleTitle: "Consensus in practice",
  author: null,
  sourceName: "Example Engineering",
};

async function render(): Promise<string> {
  const { default: HomePage } = await import("./page");
  return renderToStaticMarkup(await HomePage());
}

test("without a session the visitor is sent to /join", async () => {
  current.mockResolvedValue(null);
  await expect(render()).rejects.toThrow("redirect:/join");
  expect(getFeed).not.toHaveBeenCalled();
});

test("renders one card per feed entry", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue([
    card,
    { ...card, momentId: "2", sectionNumber: 2 },
  ]);
  const html = await render();
  expect(html.match(/<article/g)).toHaveLength(2);
  expect(html).toContain('href="https://webfeed.example.test/post"');
  expect(html).toContain("Example Engineering");
});

test("renders an empty state when the feed is empty", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue([]);
  expect(await render()).toContain("No moments yet.");
});
