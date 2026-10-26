import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, FeedCard, FeedReader } from "../server/ports";

const getFeed = vi.fn<FeedReader["read"]>();
const feedOf = (cards: FeedCard[]) => ({ computed: true, cards });
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const emit = vi.fn();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
const getPreferences = vi.fn<(userId: string) => Promise<object | null>>(() =>
  Promise.resolve({
    topics: ["backend"],
    level: "beginner",
    breakLength: "3-8",
    onboardedAt: new Date("2026-01-01T00:00:00Z"),
  }),
);
vi.mock("../server/container", () => ({
  preferences: () => ({ get: getPreferences }),
  feedReader: () => ({ read: getFeed, starter: vi.fn() }),
  sessionReader: () => ({ current }),
  events: () => ({ emit }),
  entitlements: () => ({ can }),
}));
let chipCookie: string | undefined;
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        if (name === "iv_visit") return { name, value: "visit-9.1790000000" };
        if (name === "iv_chip" && chipCookie !== undefined) {
          return { name, value: chipCookie };
        }
        return undefined;
      },
    }),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const guest: Actor = { userId: "u1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  chipCookie = undefined;
  getFeed.mockReset();
  current.mockReset();
  emit.mockReset();
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

async function render(
  params: Record<string, string | string[]> = {},
): Promise<string> {
  const { default: HomePage } = await import("./page");
  return renderToStaticMarkup(
    await HomePage({ searchParams: Promise.resolve(params) }),
  );
}

test("without a session the visitor is sent to /join", async () => {
  current.mockResolvedValue(null);
  await expect(render()).rejects.toThrow("redirect:/join");
  expect(getFeed).not.toHaveBeenCalled();
});

test("renders one card per feed entry", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(
    feedOf([card, { ...card, momentId: "2", sectionNumber: 2 }]),
  );
  const html = await render();
  expect(html.match(/<article/g)).toHaveLength(2);
  expect(html).toContain('href="https://webfeed.example.test/post"');
  expect(html).toContain("Example Engineering");
});

test("viewing the feed emits feed_viewed with the card count and the visit", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card, { ...card, momentId: "2" }]));
  await render();
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "feed_viewed",
    { card_count: 2 },
    { userId: "u1", isGuest: true, betaGroup: "student", sessionId: "visit-9" },
  );
});

test("renders an empty state when the feed is empty", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  expect(await render()).toContain("No moments yet.");
});

// OPS-3: the feed is a capability; a plan without it sees a message, not the feed.
test("without feed.read the page says so and never reads the feed", async () => {
  current.mockResolvedValue(guest);
  can.mockResolvedValueOnce(false);
  const html = await render();
  expect(html).toContain("Your plan doesn&#x27;t include the feed.");
  // The way out (sign up, for a guest) stays on the page.
  expect(html).toContain('href="/sign-up"');
  expect(can).toHaveBeenCalledWith("u1", "feed.read");
  expect(getFeed).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test("a user who hasn't onboarded is sent to /onboarding first", async () => {
  current.mockResolvedValue(guest);
  getPreferences.mockResolvedValueOnce(null);
  await expect(render()).rejects.toThrow("redirect:/onboarding");
  expect(getFeed).not.toHaveBeenCalled();
});

// Q-P1-16: three time chips; the selected one decides the feed (P1-W4-S05).
test("renders the three chips as links and marks the onboarding one", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  const html = await render();
  for (const chip of ["1-3", "3-8", "8-15"]) {
    expect(html).toContain(`href="/?chip=${chip}"`);
  }
  expect(html).toContain('<a aria-current="true" href="/?chip=3-8">');
  expect(html.match(/aria-current/g)).toHaveLength(1);
  expect(getFeed).toHaveBeenCalledWith("u1", "3-8", 50);
  expect(html).toContain("Fits your 3–8 min break");
});

test("a chip in the link picks that chip's feed", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  const html = await render({ chip: "1-3" });
  expect(getFeed).toHaveBeenCalledWith("u1", "1-3", 50);
  expect(html).toContain('<a aria-current="true" href="/?chip=1-3">');
  expect(html).toContain("Fits your 1–3 min break");
});

test("the chip chosen earlier in the session is kept", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  chipCookie = "8-15";
  await render();
  expect(getFeed).toHaveBeenCalledWith("u1", "8-15", 50);
});
