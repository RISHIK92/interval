import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, FeedCard, FeedReader, Progress } from "../server/ports";

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
const notInterested = vi.fn<
  (userId: string, itemId: string) => Promise<boolean>
>(() => Promise.resolve(false));
vi.mock("../server/container", () => ({
  preferences: () => ({ get: getPreferences }),
  feedback: () => ({ notInterested }),
  progress: () => ({ describe: describe_, nextMoment, continueCards }),
  feedReader: () => ({ read: getFeed, starter: vi.fn() }),
  sessionReader: () => ({ current }),
  events: () => ({ emit }),
  entitlements: () => ({ can }),
}));
let chipCookie: string | undefined;
let readingCookie: string | undefined;
const describe_ = vi.fn<Progress["describe"]>(() => Promise.resolve(null));
const nextMoment = vi.fn<Progress["nextMoment"]>(() => Promise.resolve(null));
const continueCards = vi.fn<Progress["continueCards"]>(() =>
  Promise.resolve([]),
);
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        if (name === "iv_visit") return { name, value: "visit-9.1790000000" };
        if (name === "iv_chip" && chipCookie !== undefined) {
          return { name, value: chipCookie };
        }
        if (name === "iv_reading" && readingCookie !== undefined) {
          return { name, value: readingCookie };
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
  readingCookie = undefined;
  describe_.mockClear();
  nextMoment.mockClear();
  getFeed.mockReset();
  current.mockReset();
  emit.mockReset();
});

const card: FeedCard = {
  kind: "moment",
  itemId: "10",
  momentId: "1",
  sectionTitle: "Why consensus",
  sectionNumber: 1,
  sectionCount: 2,
  estimatedMinutes: 2,
  articleTitle: "Consensus in practice",
  author: null,
  sourceName: "Example Engineering",
  note: null,
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
  // Through /out, which records the open (P1-W5-S01).
  expect(html).toContain(
    'href="/out?item=10&amp;moment=1&amp;chip=3-8&amp;pos=1',
  );
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
  // Separate list items, and the selected chip is visibly marked, not only for
  // screen readers.
  expect(html).toContain(
    '<li><a aria-current="true" href="/?chip=3-8"><strong>3–8 min</strong></a></li>',
  );
  expect(html).toContain('<li><a href="/?chip=1-3">1–3 min</a></li>');
  expect(html.match(/aria-current/g)).toHaveLength(1);
  expect(html.match(/<strong>/g)).toHaveLength(1);
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

test("the 8–15 chip renders whole-article cards next to moments", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(
    feedOf([
      {
        kind: "article",
        itemId: "20",
        estimatedMinutes: null,
        articleTitle: "A whole read",
        author: null,
        sourceName: "Example Engineering",
        note: null,
      },
      card,
    ]),
  );
  const html = await render({ chip: "8-15" });
  expect(html).toContain("Whole article · Length unknown");
  expect(html).toContain(
    'href="/out?item=20&amp;chip=8-15&amp;pos=1&amp;target=original"',
  );
  expect(html.match(/<article/g)).toHaveLength(2);
});

// P1-W4-S07, C-20: Save on the card; the other controls in its overflow menu.
test("every card offers Save and the four other controls", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  const html = await render();
  expect(html).toContain('name="itemId" value="10"');
  for (const control of [
    "save",
    "more_like_this",
    "less_like_this",
    "not_interested",
    "hide_source",
  ]) {
    expect(html).toMatch(new RegExp(`<button[^>]*value="${control}"[^>]*>`));
  }
  expect(html).toContain("<details>");
  expect(html).toContain('aria-label="Save Why consensus"');
});

test("after Not interested the page offers Undo for that item only", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  notInterested.mockResolvedValueOnce(true);
  const html = await render({ undo: "77" });
  expect(notInterested).toHaveBeenCalledWith("u1", "77");
  expect(html).toContain('value="undo_not_interested" name="control"');
  expect(html).toContain('name="itemId" value="77"');
  notInterested.mockResolvedValueOnce(false);
  expect(await render({ undo: "78" })).not.toContain("undo_not_interested");
  notInterested.mockClear();
  expect(await render({ undo: "abc" })).not.toContain("undo_not_interested");
  expect(notInterested).not.toHaveBeenCalled();
});

// P1-W4-S08: the Profile page, from the header until the avatar arrives (C-06).
test("the header links to the Profile page", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  expect(await render()).toContain('href="/profile"');
});

// P1-W5-S02: the Now reading panel (C-22) and what comes after a finish.
test("Now reading offers Mark section done and Dismiss for the open card", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  readingCookie = "10.1";
  describe_.mockResolvedValueOnce({
    articleTitle: "Consensus in practice",
    sectionTitle: "Why consensus",
  });
  const html = await render();
  expect(describe_).toHaveBeenCalledWith("10", "1");
  expect(html).toContain("Now reading: Why consensus — Consensus in practice");
  expect(html).toContain("Mark section done");
  expect(html).toMatch(/<button[^>]*value="dismiss"/);
});

test("a whole article's panel says Mark article done", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  readingCookie = "20.";
  describe_.mockResolvedValueOnce({
    articleTitle: "A whole read",
    sectionTitle: null,
  });
  const html = await render();
  expect(describe_).toHaveBeenCalledWith("20", null);
  expect(html).toContain("Now reading: A whole read");
  expect(html).toContain("Mark article done");
});

test("a reading cookie that names nothing real shows no panel", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  readingCookie = "10.1";
  expect(await render()).not.toContain("Now reading");
  readingCookie = "garbage";
  describe_.mockClear();
  expect(await render()).not.toContain("Now reading");
  expect(describe_).not.toHaveBeenCalled();
});

test("after a section is finished the next one is offered, or the end is said", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  describe_.mockResolvedValue({
    articleTitle: "Consensus in practice",
    sectionTitle: "Why consensus",
  });
  nextMoment.mockResolvedValueOnce({
    momentId: "2",
    title: "Raft in practice",
  });
  const html = await render({ finished: "10.1" });
  expect(nextMoment).toHaveBeenCalledWith("10", "1");
  expect(html).toContain("Continue: ");
  // Owner, 2026-10-26: a Continue open counts as continue_clicked, not a feed card.
  expect(html).toContain(
    'href="/out?item=10&amp;moment=2&amp;chip=3-8&amp;from=continue&amp;target=section"',
  );
  nextMoment.mockResolvedValueOnce(null);
  expect(await render({ finished: "10.1" })).toContain(
    "That was the last section.",
  );
  describe_.mockReset();
  describe_.mockResolvedValue(null);
});

test("a finished param naming nothing real, or a whole article, says nothing more", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  const unknown = await render({ finished: "10.999" });
  expect(unknown).not.toContain("Continue:");
  expect(unknown).not.toContain("last section");
  nextMoment.mockClear();
  const article = await render({ finished: "10." });
  expect(article).not.toContain("Continue:");
  expect(article).not.toContain("last section");
  expect(nextMoment).not.toHaveBeenCalled();
});

test("card links carry what the return prompt asks about", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  const html = await render();
  expect(html).toMatch(/<a[^>]*data-item="10"[^>]*data-moment="1"/);
});

// P1-W5-S03 (Q-P1-40): half-read articles, above the feed in every chip.
test("continue cards point at the next section and can be dismissed", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  continueCards.mockResolvedValueOnce([
    {
      itemId: "30",
      momentId: "31",
      sectionTitle: "Raft",
      sectionNumber: 2,
      sectionCount: 3,
      articleTitle: "Consensus in practice",
    },
  ]);
  const html = await render({ chip: "1-3" });
  expect(continueCards).toHaveBeenCalledWith("u1", expect.any(Date), 3);
  expect(html).toContain("Continue reading");
  expect(html).toContain("Raft — Consensus in practice · Section 2 of 3");
  expect(html).toContain(
    'href="/out?item=30&amp;moment=31&amp;chip=1-3&amp;from=continue&amp;target=section"',
  );
  expect(html).toMatch(/<a[^>]*data-item="30"[^>]*data-moment="31"/);
  expect(html).toContain("Dismiss");
});
