import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { FeedCard } from "../server/ports";

const getFeed = vi.fn<(limit: number) => Promise<FeedCard[]>>();
vi.mock("../server/container", () => ({
  feedReader: () => ({ list: getFeed }),
}));

afterEach(() => {
  getFeed.mockReset();
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

test("renders one card per feed entry", async () => {
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
  getFeed.mockResolvedValue([]);
  expect(await render()).toContain("No moments yet.");
});
