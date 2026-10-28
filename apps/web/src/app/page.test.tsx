import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  FeedCard,
  FeedReader,
  Notes,
  Progress,
  Quizzes,
} from "../server/ports";

const getFeed = vi.fn<FeedReader["read"]>();
const feedOf = (cards: FeedCard[]) => ({ computed: true, cards });
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const emit = vi.fn();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
const getPreferences = vi.fn<(userId: string) => Promise<object | null>>(() =>
  Promise.resolve({
    goals: ["system-design-interviews"],
    topics: ["backend"],
    level: "beginner",
    breakLength: "3-8",
    onboardedAt: new Date("2026-01-01T00:00:00Z"),
    firstName: null,
  }),
);
const notInterested = vi.fn<
  (userId: string, itemId: string) => Promise<boolean>
>(() => Promise.resolve(false));
vi.mock("../server/container", () => ({
  preferences: () => ({ get: getPreferences }),
  feedback: () => ({ notInterested }),
  progress: () => ({ describe: describe_, nextMoment, continueCards }),
  notes: () => ({ get: getNote, onItems }),
  feedReader: () => ({ read: getFeed, starter: vi.fn() }),
  sessionReader: () => ({ current }),
  events: () => ({ emit }),
  entitlements: () => ({ can }),
  quizzes: () => ({ offered, dueReviews }),
}));
const dueReviews = vi.fn<Quizzes["dueReviews"]>(() => Promise.resolve([]));
const offered = vi.fn<Quizzes["offered"]>(() => Promise.resolve(new Set()));
let chipCookie: string | undefined;
let readingCookie: string | undefined;
const describe_ = vi.fn<Progress["describe"]>(() => Promise.resolve(null));
const getNote = vi.fn<Notes["get"]>(() => Promise.resolve(null));
const onItems = vi.fn<Notes["onItems"]>(() => Promise.resolve([]));
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
  saved: false,
  frameable: false,
  topic: null,
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
  expect(html).toMatch(
    /<li[^>]*><a aria-current="true"[^>]*href="\/\?chip=3-8"><strong>3–8 min<\/strong><\/a><\/li>/,
  );
  expect(html).toMatch(
    /<li[^>]*><a [^>]*href="\/\?chip=1-3">1–3 min<\/a><\/li>/,
  );
  expect(html.match(/aria-current="true"/g)).toHaveLength(1); // one chip; the tab is "page"
  expect(html.match(/<strong>/g)).toHaveLength(1);
  expect(getFeed).toHaveBeenCalledWith("u1", "3-8", 50);
  expect(html).toContain("Fits your 3–8 min break");
});

test("a chip in the link picks that chip's feed", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  const html = await render({ chip: "1-3" });
  expect(getFeed).toHaveBeenCalledWith("u1", "1-3", 50);
  expect(html).toMatch(/<a aria-current="true"[^>]*href="\/\?chip=1-3">/);
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
        saved: false,
        frameable: false,
        topic: null,
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
  // The overflow menu stays a native disclosure: no client script.
  expect(html).toMatch(
    /<details[^>]*><summary[^>]*>.*More options.*<\/summary>/,
  );
  expect(html).toContain('aria-label="Save Why consensus"');
});

test("after Not interested the page offers Undo for that item only", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  notInterested.mockResolvedValueOnce(true);
  const html = await render({ undo: "77" });
  expect(notInterested).toHaveBeenCalledWith("u1", "77");
  expect(html).toMatch(
    /<button[^>]*value="undo_not_interested"[^>]*name="control"[^>]*>Undo</,
  );
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
  expect(await render()).toMatch(
    /<a[^>]*href="\/profile"[^>]*aria-label="Profile"|<a[^>]*aria-label="Profile"[^>]*href="\/profile"/,
  );
});

// ADR-0019: one full-size card at a time in a sideways row, so each title gets read;
// no "More for your …" list.
test("every card is full size in one sideways feed", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(
    feedOf([
      card,
      { ...card, momentId: "2", sectionNumber: 2, sectionTitle: "Raft" },
    ]),
  );
  const html = await render();
  expect(html).not.toContain("More for your");
  const feed = html.slice(html.indexOf('aria-label="Your feed"'));
  expect(feed).toMatch(/^aria-label="Your feed"[^>]*tabindex="0"/i);
  expect(feed).toMatch(/snap-x/);
  expect(feed.match(/<li /g)).toHaveLength(2);
  // One swipe moves one card: the row stops at every card (owner, 2026-10-26).
  expect(feed.match(/<li [^>]*class="[^"]*snap-always/g)).toHaveLength(2);
  expect(feed).toContain("Why consensus");
  expect(feed).toContain(">Raft<");
  // Both cards have the full-size controls.
  expect(feed.match(/size-11/g)?.length).toBeGreaterThanOrEqual(2);
  expect(feed).not.toContain("size-9");
});

// ADR-0019: the design's right column, greyed until its features exist.
test("the wide layout's column shows four coming-later panels", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  const html = await render();
  const column = html.slice(html.indexOf('aria-label="Coming later"'));
  for (const name of [
    "Streak",
    "Your path",
    "Review queue",
    "Tonight’s battle",
  ]) {
    expect(column).toContain(name);
  }
  expect(column.match(/Coming later/g)?.length).toBeGreaterThanOrEqual(4);
});

// ADR-0019: the server says a plain hello by first name; the device picks the line.
test("the heading greets by first name before the device picks a line", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  getPreferences.mockResolvedValueOnce({
    goals: ["system-design-interviews"],
    topics: ["backend"],
    level: "beginner",
    breakLength: "3-8",
    onboardedAt: new Date("2026-01-01T00:00:00Z"),
    firstName: "Ada",
  });
  const html = await render();
  expect(html).toContain("How long is this break?");
  expect(html).toMatch(/<h1[^>]*>Hey, Ada\.<\/h1>/);
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
  expect(html).toContain("Now reading");
  expect(html).toContain("Why consensus — Consensus in practice");
  expect(html).toContain("Mark section done");
  expect(html).toMatch(/<button[^>]*value="dismiss"/);
});

// A section titled like its article (the AWS posts) names it once.
test("Now reading doesn't repeat a section title that matches the article", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  readingCookie = "10.1";
  describe_.mockResolvedValueOnce({
    articleTitle: "Origin Range Requests",
    sectionTitle: "Origin Range Requests",
  });
  expect(await render()).toMatch(
    /Now reading<\/p><p[^>]*>Origin Range Requests<\/p>/,
  );
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
  expect(html).toMatch(/Now reading<\/p><p[^>]*>A whole read<\/p>/);
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
    frameable: false,
  });
  const html = await render({ finished: "10.1" });
  expect(nextMoment).toHaveBeenCalledWith("10", "1");
  expect(html).toContain("Continue: ");
  // Owner, 2026-10-26: a Continue open counts as continue_clicked, not a feed card.
  expect(html).toContain(
    'href="/out?item=10&amp;moment=2&amp;from=continue&amp;target=section"',
  );
  // A page the reader can frame opens there, in this tab (ADR-0018).
  nextMoment.mockResolvedValueOnce({
    momentId: "2",
    title: "Raft in practice",
    frameable: true,
  });
  expect(await render({ finished: "10.1" })).toMatch(
    /<a href="\/read\/10\?moment=2&amp;chip=3-8&amp;from=continue" data-read-item="10" data-read-moment="2"[^>]*>Raft in practice<\/a>/,
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
      frameable: false,
    },
  ]);
  const html = await render({ chip: "1-3" });
  expect(continueCards).toHaveBeenCalledWith("u1", expect.any(Date), 3);
  expect(html).toContain("Continue reading");
  expect(html).toContain('aria-label="Continue: Raft — Consensus in practice"');
  expect(html).toContain("Section 2 of 3");
  expect(html).toContain(
    'href="/out?item=30&amp;moment=31&amp;from=continue&amp;target=section"',
  );
  expect(html).toMatch(/<a[^>]*data-item="30"[^>]*data-moment="31"/);
  expect(html).toContain("Dismiss");
});

test("a saved card's button says Saved and unsaves", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([{ ...card, saved: true }]));
  const html = await render();
  // An icon button: its label is its whole name, and says it is saved.
  expect(html).toMatch(
    /<button[^>]*value="unsave" aria-label="Saved: unsave Why consensus"/,
  );
  getFeed.mockResolvedValue(feedOf([card]));
  expect(await render()).toMatch(
    /<button[^>]*value="save" aria-label="Save Why consensus"/,
  );
});

test("the Home tab is marked current", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  const html = await render();
  expect(html).toMatch(/<a aria-current="page"[^>]*href="\/">.*?Home<\/a>/);
  expect(html).toMatch(/href="\/library">.*?Library<\/a>/);
});

// ADR-0018: closing the in-app reader comes back asking about what it showed.
test("ask= opens the prompt for that card; a bad one is ignored", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  const section = await render({ ask: "10.1" });
  expect(section).toContain("Finished this section?");
  expect(section).toContain('name="itemId" value="10"');
  expect(section).toContain('name="momentId" value="1"');
  expect(section).toContain('name="method" value="return_prompt"');
  const article = await render({ ask: "20." });
  expect(article).toContain("Finished this article?");
  expect(article).not.toContain('name="momentId"');
  for (const ask of ["10.x", "0.1", "javascript:1", ""]) {
    expect(await render({ ask })).not.toContain("Finished this");
  }
  expect(await render({ ask: ["10.1", "11.1"] })).not.toContain(
    "Finished this",
  );
});

test("a frameable card opens in the in-app reader, in this tab", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([{ ...card, frameable: true }]));
  continueCards.mockResolvedValueOnce([
    {
      itemId: "30",
      momentId: "31",
      sectionTitle: "Raft",
      sectionNumber: 2,
      sectionCount: 3,
      articleTitle: "Consensus in practice",
      frameable: true,
    },
  ]);
  const html = await render();
  expect(html).toMatch(
    /<a href="\/read\/10\?moment=1&amp;chip=3-8&amp;pos=1" data-read-item="10" data-read-moment="1" class="[^"]*">Read article<\/a>/,
  );
  // Continue too, without data-item: the visibility prompt mustn't arm for it; the
  // reader marker asks on Back instead.
  expect(html).toMatch(
    /<a href="\/read\/30\?moment=31&amp;chip=3-8&amp;from=continue" data-read-item="30" data-read-moment="31" aria-label="Continue: Raft — Consensus in practice" class="[^"]*">Continue<\/a>/,
  );
  // Open original website still leaves for the browser, from the card's "…" menu
  // (owner, 2026-10-26).
  expect(html).toMatch(
    /<details[^>]*>(?:(?!<\/details>)[^])*<a href="\/out\?item=10&amp;moment=1&amp;chip=3-8&amp;pos=1&amp;target=original" target="_blank" rel="noopener noreferrer"[^>]*>Open original website<\/a>/,
  );
});

// An article in Continue reading isn't offered again in the feed below it (owner,
// 2026-10-27 beta check).
test("the feed leaves out articles already in Continue reading", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(
    feedOf([
      card,
      { ...card, itemId: "30", momentId: "32", sectionTitle: "Raft again" },
    ]),
  );
  continueCards.mockResolvedValueOnce([
    {
      itemId: "30",
      momentId: "31",
      sectionTitle: "Raft",
      sectionNumber: 2,
      sectionCount: 3,
      articleTitle: "Consensus in practice",
      frameable: false,
    },
  ]);
  const feed = (await render()).split('aria-label="Your feed"')[1] ?? "";
  expect(feed).toContain("Why consensus");
  expect(feed).not.toContain("Raft again");
});

// Q-P2-01, P2-W7-S03: a note on what's being read, written from the panel.
test("Now reading offers a note on the section, filled in when there is one", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  readingCookie = "10.1";
  describe_.mockResolvedValueOnce({
    articleTitle: "Consensus in practice",
    sectionTitle: "Why consensus",
  });
  getNote.mockResolvedValueOnce("Terms are epochs");
  const html = await render();
  expect(getNote).toHaveBeenCalledWith("u1", "10", "1");
  expect(html).toContain("Your note");
  expect(html).toMatch(
    /<textarea[^>]*name="body"[^>]*>Terms are epochs<\/textarea>/,
  );
  expect(html).toMatch(/<input[^>]*name="momentId"[^>]*value="1"/);
  expect(html).toMatch(/<button[^>]*value="delete"/);
});

// P2-W7-S04: a card shows the user's note on its own section.
test("cards show the user's notes on their sections, not on other sections", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  onItems.mockResolvedValueOnce([
    { itemId: "10", momentId: "1", body: "Mine on this section" },
    { itemId: "10", momentId: "2", body: "Mine on another" },
  ]);
  const html = await render();
  expect(onItems).toHaveBeenCalledWith("u1", ["10"]);
  expect(html).toContain("Mine on this section");
  expect(html).not.toContain("Mine on another");
});

test("an article card shows the article's note; a section card never does", async () => {
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
        saved: false,
        frameable: false,
        topic: null,
      },
      card,
    ]),
  );
  onItems.mockResolvedValueOnce([
    { itemId: "20", momentId: null, body: "On the whole read" },
    { itemId: "10", momentId: null, body: "On the consensus article" },
  ]);
  const html = await render({ chip: "8-15" });
  expect(html).toContain("On the whole read");
  expect(html).not.toContain("On the consensus article");
});

// P2-W9-S02: Test 60s from a card, and after finishing a section.
test("a card with live questions offers Test 60s on its section", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card, { ...card, momentId: "2" }]));
  offered.mockResolvedValueOnce(new Set(["10.1"]));
  const html = await render();
  expect(offered).toHaveBeenCalledWith([
    { itemId: "10", momentId: "1" },
    { itemId: "10", momentId: "2" },
  ]);
  expect(html.match(/aria-label="Test yourself: Why consensus"/g)).toHaveLength(
    1,
  );
  expect(html).toMatch(
    /<form[^>]*>(?:(?!<\/form>)[^])*name="momentId" value="1"(?:(?!<\/form>)[^])*Test yourself: Why consensus/,
  );
});

test("after finishing a section with live questions, the feed offers its test", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  describe_.mockResolvedValue({
    articleTitle: "Consensus in practice",
    sectionTitle: "Why consensus",
  });
  nextMoment.mockResolvedValue(null);
  offered.mockResolvedValue(new Set(["10.1"]));
  const html = await render({ finished: "10.1" });
  expect(html).toContain("Test yourself · 60s");
  expect(html).toContain("That was the last section.");
  offered.mockResolvedValue(new Set());
  expect(await render({ finished: "10.1" })).not.toContain(
    "Test yourself · 60s",
  );
  describe_.mockReset();
  describe_.mockResolvedValue(null);
});

// P2-W9-S06 (Q-P2-17): when anything is due, the feed's second card is the review.
test("with concepts due, the second card is the review queue, saying why", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(
    feedOf([card, { ...card, momentId: "2" }, { ...card, momentId: "3" }]),
  );
  dueReviews.mockResolvedValueOnce([
    { conceptId: "1", name: "Raft" },
    { conceptId: "2", name: "Quorum" },
    { conceptId: "3", name: "MVCC" },
    { conceptId: "4", name: "Indexes" },
  ]);
  const html = await render();
  expect(dueReviews).toHaveBeenCalledWith("u1");
  const items = html.split("<li").slice(1);
  const reviewAt = items.findIndex((li) => li.includes("Review 4 concepts"));
  const firstCard = items.findIndex((li) => li.includes('data-moment="1"'));
  const secondCard = items.findIndex((li) => li.includes('data-moment="2"'));
  expect(firstCard).toBeLessThan(reviewAt);
  expect(reviewAt).toBeLessThan(secondCard);
  expect(html).toContain("Review 4 concepts · about 2 min");
  // Every card says why it's there (§5B).
  expect(html).toContain("Due for review: Raft, Quorum, MVCC and 1 more");
  expect(html).toContain('href="/library#review-queue"');
  // The ranked cards keep their positions: the second is still position 2.
  expect(html).toMatch(/moment=2[^"]*pos=2/);
  expect(html).toMatch(/moment=3[^"]*pos=3/);
});

test("an empty feed still shows the review when something is due (owner, 2026-10-28)", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([]));
  dueReviews.mockResolvedValueOnce([{ conceptId: "1", name: "Raft" }]);
  const html = await render();
  expect(html).toContain("No moments yet.");
  expect(html).toContain("Review 1 concept · about 1 min");
  expect(html).toContain("Due for review: Raft.");
});

test("with nothing due, the feed has no review card", async () => {
  current.mockResolvedValue(guest);
  getFeed.mockResolvedValue(feedOf([card]));
  expect(await render()).not.toContain("Due for review");
});
