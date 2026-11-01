import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { DailyShare } from "../../../server/ports";

// P3-W13-S06 (§6.3): a shared daily result is public, shows the day, points, streak
// and a dot per question, and never a question.
const ID = "3f2c1a9e-5b7d-4c8e-9a1b-2d3e4f5a6b7c";
const share: DailyShare = {
  day: "2026-11-01",
  points: 262,
  streak: { days: 5, freezes: 1 },
  dots: [1, 0, 0.62, 1, 0],
};
const dailyShare = vi.fn<(id: string) => Promise<DailyShare | null>>(() =>
  Promise.resolve(share),
);
vi.mock("../../../server/container", () => ({
  quizzes: () => ({ dailyShare }),
}));
vi.mock("../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "https://interval.example" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    element: ReactElement;
    constructor(element: ReactElement) {
      super("png");
      this.element = element;
    }
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

const params = (share: string) => Promise.resolve({ share });

async function page(id = ID): Promise<string> {
  const { default: SharePage } = await import("./page");
  return renderToStaticMarkup(await SharePage({ params: params(id) }));
}

test("shows the day, points, streak and the dots, and asks the visitor to play", async () => {
  const html = await page();
  expect(dailyShare).toHaveBeenCalledWith(ID);
  expect(html).toContain("1 Nov 2026");
  expect(html).toContain("262 points");
  expect(html).toContain("5-day streak · a freeze held");
  expect(html.match(/data-dot=/g)).toHaveLength(5);
  expect(html).toContain('aria-label="Question 3: 62 points"');
  expect(html).toContain('href="/play"');
});

test("an unknown or malformed link is not found", async () => {
  dailyShare.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("notFound");
  await expect(page("1")).rejects.toThrow("notFound");
  expect(dailyShare).toHaveBeenCalledTimes(1);
});

test("the link preview says the result, from an absolute base", async () => {
  const { generateMetadata } = await import("./page");
  const metadata = await generateMetadata({ params: params(ID) });
  expect(metadata.description).toBe(
    "262 points · 5-day streak · a freeze held",
  );
  expect(metadata.metadataBase?.toString()).toBe("https://interval.example/");
});

// The image's only input is the share, which carries no question (the adapter's test
// shows no stem, choice or source reaches it); here, nothing else is drawn.
test("the preview image draws only the share's day, points, streak and dots", async () => {
  const { default: Image } = await import("./opengraph-image");
  const response = (await Image({ params: params(ID) })) as Response & {
    element: ReactElement;
  };
  expect(dailyShare).toHaveBeenCalledWith(ID);
  const html = renderToStaticMarkup(response.element);
  const text = html
    .replace(/<[^>]+>/g, "|")
    .split("|")
    .filter(Boolean);
  expect(text).toEqual([
    "Interval daily challenge",
    "1 Nov 2026",
    "262 points",
    "5-day streak · a freeze held",
  ]);
  expect(html.match(/data-dot=/g)).toHaveLength(5);
});

test("the preview image of an unknown link is a 404", async () => {
  dailyShare.mockResolvedValueOnce(null);
  const { default: Image } = await import("./opengraph-image");
  expect((await Image({ params: params(ID) })).status).toBe(404);
});
