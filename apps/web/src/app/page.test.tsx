import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Books,
  FeedCard,
  FeedReader,
  Notes,
  Paths,
  Progress,
  Quizzes,
  Usernames,
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
    onboardedAt: new Date("2026-01-01T00:00:00Z"),
    firstName: null,
  }),
);
const notInterested = vi.fn<
  (userId: string, itemId: string) => Promise<boolean>
>(() => Promise.resolve(false));
const usernameGet = vi.fn<Usernames["get"]>(() =>
  Promise.resolve({ username: "ada", searchable: true }),
);
const applyEvidence = vi.fn(() => Promise.resolve());
vi.mock("./play/live/evidence", () => ({ applyMatchEvidence: applyEvidence }));
const agentRunning = vi.fn(() => Promise.resolve(null));
const agentPlace = vi.fn<() => Promise<string | null>>(() =>
  Promise.resolve(null),
);
vi.mock("../server/container", () => ({
  usernames: () => ({ get: usernameGet }),
  preferences: () => ({ get: getPreferences }),
  feedback: () => ({ notInterested }),
  progress: () => ({ describe: describe_, continueCards }),
  notes: () => ({ get: getNote, onItems }),
  feedReader: () => ({ read: getFeed, starter: vi.fn() }),
  sessionReader: () => ({ current }),
  events: () => ({ emit }),
  entitlements: () => ({ can }),
  agentHook: () => ({ running: agentRunning, place: agentPlace }),
  quizzes: () => ({ offered, dueReviews, dailyStatus }),
  paths: () => ({ next: pathNext }),
  books: () => ({ nextSession }),
}));
const nextSession = vi.fn<Books["nextSession"]>(() => Promise.resolve(null));
const pathNext = vi.fn<Paths["next"]>(() => Promise.resolve(null));
const dueReviews = vi.fn<Quizzes["dueReviews"]>(() => Promise.resolve([]));
const dailyStatus = vi.fn<Quizzes["dailyStatus"]>(() =>
  Promise.resolve({ today: "none", streak: { days: 0, freezes: 0 } }),
);
const offered = vi.fn<Quizzes["offered"]>(() => Promise.resolve(new Set()));
let readingCookie: string | undefined;
const describe_ = vi.fn<Progress["describe"]>(() => Promise.resolve(null));
const getNote = vi.fn<Notes["get"]>(() => Promise.resolve(null));
const onItems = vi.fn<Notes["onItems"]>(() => Promise.resolve([]));
const continueCards = vi.fn<Progress["continueCards"]>(() =>
  Promise.resolve([]),
);
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        if (name === "iv_visit") return { name, value: "visit-9.1790000000" };
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
const user: Actor = { ...guest, isGuest: false };

afterEach(() => {
  readingCookie = undefined;
  describe_.mockClear();
  getFeed.mockReset();
  current.mockReset();
  emit.mockReset();
});

// ADR-0058: every card is an article.
const card: FeedCard = {
  itemId: "10",
  estimatedMinutes: 2,
  articleTitle: "Why consensus",
  author: null,
  sourceName: "Example Engineering",
  reasons: null,
  projectNote: null,
  saved: false,
  frameable: false,
  topic: null,
  difficulty: null,
  state: "unread",
};
const other = (
  itemId: string,
  articleTitle = `Article ${itemId}`,
): FeedCard => ({
  ...card,
  itemId,
  articleTitle,
});

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
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card, other("11")]));
  const html = await render();
  expect(html.match(/<article/g)).toHaveLength(2);
  // Through /out, which records the open (P1-W5-S01).
  expect(html).toContain('href="/out?item=10&amp;pos=1&amp;target=article"');
  expect(html).toContain('href="/out?item=11&amp;pos=2&amp;target=article"');
  expect(getFeed).toHaveBeenCalledWith("u1", 50);
  expect(html).toContain("Example Engineering");
});

test("viewing the feed emits feed_viewed with the card count and the visit", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card, other("11")]));
  await render();
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "feed_viewed",
    { card_count: 2 },
    {
      userId: "u1",
      isGuest: false,
      betaGroup: "student",
      sessionId: "visit-9",
    },
  );
});

test("renders an empty state when the feed is empty", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  expect(await render()).toContain("Nothing to read yet.");
});

// OPS-3: the feed is a capability; a plan without it sees a message, not the feed.
test("without feed.read the page says so and never reads the feed", async () => {
  current.mockResolvedValue(user);
  can.mockResolvedValueOnce(false);
  const html = await render();
  expect(html).toContain("Your plan doesn&#x27;t include the feed.");
  // The way out (sign out) stays on the page.
  expect(html).toContain("Sign out");
  expect(can).toHaveBeenCalledWith("u1", "feed.read");
  expect(getFeed).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test("a user who hasn't onboarded is sent to /onboarding first", async () => {
  current.mockResolvedValue(user);
  getPreferences.mockResolvedValueOnce(null);
  await expect(render()).rejects.toThrow("redirect:/onboarding");
  expect(getFeed).not.toHaveBeenCalled();
});

// P3-W14-S05 (owner, 2026-11-02): an account picks its username before anything else.
test("an account with no username is sent to choose one, then back to the feed", async () => {
  current.mockResolvedValue(user);
  usernameGet.mockResolvedValueOnce(null);
  await expect(render()).rejects.toThrow("redirect:/username?next=%2F");
  expect(usernameGet).toHaveBeenCalledWith("u1");
  expect(getFeed).not.toHaveBeenCalled();
});

// P3-W15-S05: a visit applies the player's finished live matches.
test("the feed applies finished live matches' evidence", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  await render();
  expect(applyEvidence).toHaveBeenCalledWith(user);
});

// ADR-0058: no time chips; one feed, and an old link's ?chip= changes nothing.
test("there are no break-length chips, and a chip in the link is ignored", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  const html = await render({ chip: "1-3" });
  expect(html).not.toContain('aria-label="Break length"');
  expect(html).not.toContain("chip=");
  expect(html).not.toContain("How long is this break?");
  expect(getFeed).toHaveBeenCalledWith("u1", 50);
});

// ADR-0058: a card shows its title, source, reading time and its state.
test("a card shows its reading time, and Continue reading once opened", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(
    feedOf([
      { ...card, state: "continue_reading" },
      { ...other("20", "A whole read"), estimatedMinutes: null },
    ]),
  );
  const words = (await render()).replace(/<[^>]+>/g, "|");
  expect(words).toContain("|2 min read||Continue reading|");
  expect(words).toContain("|Length unknown|");
  expect(words.match(/\|Continue reading\|/g)).toHaveLength(1);
});

// P1-W4-S07, C-20: Save on the card; the other controls in its overflow menu.
test("every card offers Save and the four other controls", async () => {
  current.mockResolvedValue(user);
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
  // ADR-0058: Read article is already the publisher's page; no second link to it.
  expect(html).not.toContain("Open original website");
});

// ADR-0026: the card says why it was shown, and its menu can report a reason as wrong.
test("a card shows its reasons, and each can be reported as wrong", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(
    feedOf([
      {
        ...card,
        reasons: {
          text: "System design interviews ask about Caching.",
          kinds: ["goal_match"],
        },
      },
    ]),
  );
  const html = await render({});
  expect(html).toContain("System design interviews ask about Caching.");
  expect(html).toContain("A reason is wrong");
  for (const reason of ["goal_match"]) {
    expect(html).toMatch(
      new RegExp(
        `<button[^>]*value="wrong_reason:${reason}"[^>]*name="control"`,
      ),
    );
  }
});

test("after Not interested the page offers Undo for that item only", async () => {
  current.mockResolvedValue(user);
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
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  expect(await render()).toMatch(
    /<a[^>]*href="\/profile"[^>]*aria-label="Profile"|<a[^>]*aria-label="Profile"[^>]*href="\/profile"/,
  );
});

// ADR-0019: one full-size card at a time in a sideways row, so each title gets read;
// no "More for your …" list.
test("every card is full size in one sideways feed", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card, other("11", "Raft")]));
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

// ADR-0019: the design's right column; the battle stays greyed until it exists. The
// daily challenge's streak (Q-P3-07) is live since Phase 3.
test("the wide layout's column: streak, path and review live, the battle coming later", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  const html = await render();
  const start = html.indexOf('aria-label="At a glance"');
  const column = html.slice(start, html.indexOf("</aside>", start));
  for (const name of [
    "No streak yet",
    "Your path",
    "Review queue",
    "Tonight’s battle",
  ]) {
    expect(column).toContain(name);
  }
  // No active path's next step: a link to the paths, claiming nothing.
  expect(column).toMatch(/href="\/paths"[^]*?See the paths/);
  expect(column.match(/Coming later/g)).toHaveLength(1);
});

test("the column names the streak and how many concepts are fading", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  dailyStatus.mockResolvedValueOnce({
    today: "none",
    streak: { days: 5, freezes: 0 },
  });
  dueReviews.mockResolvedValueOnce([
    { conceptId: "c1", name: "Quorums", daysSince: 3 },
    { conceptId: "c2", name: "Leases", daysSince: null },
    { conceptId: "c3", name: "Raft", daysSince: 1 },
  ]);
  const html = await render();
  const start = html.indexOf('aria-label="At a glance"');
  const column = html
    .slice(start, html.indexOf("</aside>", start))
    .replace(/<[^>]+>/g, "|");
  expect(column).toContain("5-day streak");
  expect(column).toContain("3 concepts are fading");
  expect(column).toContain("Review now · about 1 min");
});

// ADR-0019: the server says a plain hello by first name; the device picks the line.
test("the heading greets by first name before the device picks a line", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  getPreferences.mockResolvedValueOnce({
    goals: ["system-design-interviews"],
    topics: ["backend"],
    level: "beginner",
    onboardedAt: new Date("2026-01-01T00:00:00Z"),
    firstName: "Ada",
  });
  const html = await render();
  expect(html).toMatch(/<h1[^>]*>Hey, Ada\.<\/h1>/);
});

// P1-W5-S02: the Now reading panel (C-22) and what comes after a finish. ADR-0058: the
// article opened last; the cookie is its id (an old "item.moment" one still names it).
test("Now reading offers Mark article done and Dismiss for the open article", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  for (const cookie of ["10", "10.1", "10."]) {
    readingCookie = cookie;
    describe_.mockResolvedValueOnce({ articleTitle: "Consensus in practice" });
    const html = await render();
    expect(describe_).toHaveBeenLastCalledWith("10");
    expect(html).toMatch(/Now reading<\/p><p[^>]*>Consensus in practice<\/p>/);
    expect(html).toContain("Mark article done");
    expect(html).not.toContain("Mark section done");
    expect(html).not.toContain('name="momentId"');
    expect(html).toMatch(/<button[^>]*value="dismiss"/);
  }
});

test("a reading cookie that names nothing real shows no panel", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  readingCookie = "10";
  expect(await render()).not.toContain("Now reading");
  readingCookie = "garbage";
  describe_.mockClear();
  expect(await render()).not.toContain("Now reading");
  expect(describe_).not.toHaveBeenCalled();
});

// ADR-0058: no next section; a completed article says so and offers its quiz again.
test("after an article is completed, it says Completed and offers Quiz me", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  describe_.mockResolvedValue({ articleTitle: "Consensus in practice" });
  offered.mockResolvedValueOnce(new Set(["10"]));
  const html = await render({ finished: "10" });
  expect(describe_).toHaveBeenCalledWith("10");
  expect(offered).toHaveBeenCalledWith(["10"]);
  expect(html.replace(/<[^>]+>/g, "")).toContain(
    "Completed: Consensus in practice",
  );
  expect(html).toMatch(
    /<form[^>]*>(?:(?!<\/form>)[^])*name="itemId" value="10"(?:(?!<\/form>)[^])*Quiz me/,
  );
  expect(html).not.toContain("Next section");
  expect(html).not.toContain("last section");
  // No live question: Completed, without the quiz.
  expect(await render({ finished: "10" })).not.toContain("Quiz me");
  describe_.mockReset();
  describe_.mockResolvedValue(null);
});

test("a finished param naming nothing real says nothing", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  expect(await render({ finished: "10" })).not.toContain("Completed:");
  expect(await render({ finished: "x" })).not.toContain("Completed:");
});

test("card links carry what the return prompt asks about", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  const html = await render();
  expect(html).toMatch(/<a[^>]*data-item="10"/);
  expect(html).not.toContain("data-moment");
});

// P1-W5-S03 (Q-P1-40), ADR-0058: articles opened and not completed, above the feed.
const continuing = {
  itemId: "30",
  articleTitle: "Consensus in practice",
  sourceName: "Example Engineering",
  estimatedMinutes: 9,
  frameable: false,
};
test("continue cards open the article and can be dismissed", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  continueCards.mockResolvedValueOnce([continuing]);
  const html = await render();
  expect(continueCards).toHaveBeenCalledWith("u1", expect.any(Date), 3);
  expect(html).toContain("Continue reading");
  expect(html).toContain(
    'aria-label="Continue reading: Consensus in practice"',
  );
  expect(html).toContain("Example Engineering · 9 min");
  expect(html).not.toContain("Section ");
  expect(html).toContain(
    'href="/out?item=30&amp;from=continue&amp;target=article"',
  );
  expect(html).toMatch(/<a[^>]*data-item="30"/);
  expect(html).toContain("Dismiss");
});

test("a saved card's button says Saved and unsaves", async () => {
  current.mockResolvedValue(user);
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
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  const html = await render();
  expect(html).toMatch(/<a aria-current="page"[^>]*href="\/">.*?Home<\/a>/);
  expect(html).toMatch(/href="\/library">.*?Library<\/a>/);
});

// ADR-0018: closing the in-app reader comes back asking about what it showed.
// ADR-0058: always the article; an old "item.moment" value still names it.
test("ask= opens the prompt for that article; a bad one is ignored", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  for (const ask of ["10", "10.1"]) {
    const html = await render({ ask });
    expect(html).toContain("Finished this article?");
    expect(html).toContain('name="itemId" value="10"');
    expect(html).not.toContain('name="momentId"');
    expect(html).toContain('name="method" value="return_prompt"');
  }
  for (const ask of ["10.x", "0", "javascript:1", ""]) {
    expect(await render({ ask })).not.toContain("Finished this");
  }
  expect(await render({ ask: ["10", "11"] })).not.toContain("Finished this");
});

test("a frameable card opens in the in-app reader, in this tab", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([{ ...card, frameable: true }]));
  continueCards.mockResolvedValueOnce([{ ...continuing, frameable: true }]);
  const html = await render();
  expect(html).toMatch(
    /<a href="\/read\/10\?pos=1" data-read-item="10" class="[^"]*">(?:<svg[^]*?<\/svg>)?Read article<\/a>/,
  );
  // Continue too, without data-item: the visibility prompt mustn't arm for it; the
  // reader marker asks on Back instead.
  expect(html).toMatch(
    /<a href="\/read\/30\?from=continue" data-read-item="30" aria-label="Continue reading: Consensus in practice" class="[^"]*">Continue<\/a>/,
  );
});

// An article in Continue reading isn't offered again in the feed below it (owner,
// 2026-10-27 beta check).
test("the feed leaves out articles already in Continue reading", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card, other("30", "Raft again")]));
  continueCards.mockResolvedValueOnce([continuing]);
  const feed = (await render()).split('aria-label="Your feed"')[1] ?? "";
  expect(feed).toContain("Why consensus");
  expect(feed).not.toContain("Raft again");
});

// Q-P2-01, P2-W7-S03: a note on what's being read, written from the panel.
test("Now reading offers a note on the article, filled in when there is one", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  readingCookie = "10";
  describe_.mockResolvedValueOnce({ articleTitle: "Consensus in practice" });
  getNote.mockResolvedValueOnce("Terms are epochs");
  const html = await render();
  expect(getNote).toHaveBeenCalledWith("u1", "10");
  expect(html).toContain("Your note");
  expect(html).toMatch(
    /<textarea[^>]*name="body"[^>]*>Terms are epochs<\/textarea>/,
  );
  expect(html).not.toMatch(/<input[^>]*name="momentId"/);
  expect(html).toMatch(/<button[^>]*value="delete"/);
});

// P2-W7-S04: a card shows the user's note on its article.
test("cards show the user's note on their article", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card, other("20")]));
  onItems.mockResolvedValueOnce([
    { itemId: "10", body: "Mine on this article" },
  ]);
  const html = await render();
  expect(onItems).toHaveBeenCalledWith("u1", ["10", "20"]);
  expect(html).toContain("Mine on this article");
});

// P2-W9-S02, ADR-0058: Quiz me from a card, on the whole article.
test("a card with live questions offers Quiz me on its article", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card, other("11")]));
  offered.mockResolvedValueOnce(new Set(["10"]));
  const html = await render();
  expect(offered).toHaveBeenCalledWith(["10", "11"]);
  expect(html.match(/aria-label="Quiz me: Why consensus"/g)).toHaveLength(1);
  expect(html).not.toContain("Quiz me: Article 11");
  expect(html).toMatch(
    /<form[^>]*>(?:(?!<\/form>)[^])*name="itemId" value="10"(?:(?!<\/form>)[^])*Quiz me: Why consensus/,
  );
});

// P2-W9-S06 (Q-P2-17): when anything is due, the feed's second card is the review.
const text = (html: string) => html.replace(/<[^>]+>/g, "");

test("with concepts due, the second card is the review queue, saying why", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card, other("11"), other("12")]));
  dueReviews.mockResolvedValueOnce([
    { conceptId: "1", name: "Raft", daysSince: 2 },
    { conceptId: "2", name: "Quorum", daysSince: 3 },
    { conceptId: "3", name: "MVCC", daysSince: 4 },
    { conceptId: "4", name: "Indexes", daysSince: 5 },
  ]);
  const html = await render();
  expect(dueReviews).toHaveBeenCalledWith("u1");
  const items = html.split("<li").slice(1);
  const reviewAt = items.findIndex((li) => li.includes("Review 4 concepts"));
  const firstCard = items.findIndex((li) => li.includes('data-item="10"'));
  const secondCard = items.findIndex((li) => li.includes('data-item="11"'));
  expect(firstCard).toBeLessThan(reviewAt);
  expect(reviewAt).toBeLessThan(secondCard);
  expect(html).toContain("Review 4 concepts · about 2 min");
  expect(html).toContain("4 concepts are fading");
  // Every card says why it's there (§5B): each due concept, and when it was last
  // recalled (owner, 2026-10-30: the card felt empty).
  expect(html).toContain("Due for review");
  const words = text(html);
  expect(words).toContain("Raftlast recalled 2 days ago");
  expect(words).toContain("Quorumlast recalled 3 days ago");
  expect(words).not.toContain("MVCClast recalled");
  expect(words).toContain("and 2 more");
  // The button starts the review itself, in the user's words (owner, 2026-10-30).
  expect(html).not.toContain("review queue");
  expect(words).toContain("Start quiz");
  expect(html).not.toContain('name="chip"');
  // The ranked cards keep their positions: the second is still position 2.
  expect(html).toContain("item=11&amp;pos=2");
  expect(html).toContain("item=12&amp;pos=3");
});

test("an empty feed still shows the review when something is due (owner, 2026-10-28)", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  dueReviews.mockResolvedValueOnce([
    { conceptId: "1", name: "Raft", daysSince: 2 },
  ]);
  const html = await render();
  expect(html).toContain("Nothing to read yet.");
  expect(html).toContain("Review 1 concept · about 1 min");
  expect(text(html)).toContain("Raftlast recalled 2 days ago");
});

test("with nothing due, the feed has no review card", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  expect(await render()).not.toContain("Due for review");
});

// P3-W13-S05 (§6.1): today's challenge is a card while it's still to play.
test("today's challenge is a card, saying why, until it's played", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card, other("11")]));
  dailyStatus.mockResolvedValueOnce({
    today: "open",
    streak: { days: 3, freezes: 0 },
  });
  const html = await render();
  expect(dailyStatus).toHaveBeenCalledWith("u1");
  expect(can).toHaveBeenCalledWith("u1", "play.daily");
  expect(html).toContain("Today&#x27;s 5 questions · 2 minutes");
  expect(html).toContain("The same set for everyone today, one attempt.");
  expect(html).toContain("Keep your 3-day streak.");
  expect(html).toContain("Start today&#x27;s challenge");
  // The ranked cards keep their positions.
  expect(html).toContain("item=11&amp;pos=2");
  for (const today of [
    "none" as const,
    { attemptId: "71", finished: true, points: 300 },
  ]) {
    dailyStatus.mockResolvedValueOnce({
      today,
      streak: { days: 0, freezes: 0 },
    });
    expect(await render()).not.toContain("Today&#x27;s 5 questions");
  }
});

test("a plan without the daily challenge shows no card for it", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  dailyStatus.mockResolvedValueOnce({
    today: "open",
    streak: { days: 0, freezes: 0 },
  });
  can.mockImplementation((_user, capability) =>
    Promise.resolve(capability !== "play.daily"),
  );
  expect(await render()).not.toContain("Today&#x27;s 5 questions");
});

// P2-W10-S06 (REC-1, Q-P2-27): the active path's next step is the first card.
const reading = {
  itemId: "50",
  articleTitle: "Designing data systems",
  sourceName: "Pub",
  minutes: 4,
  frameable: true,
  linkBroken: false,
  finished: false,
  ordinal: 0,
};

test("the path's next reading is the first card, saying why, as a path open", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card, other("11")]));
  pathNext.mockResolvedValueOnce({
    kind: "reading",
    pathId: "6",
    pathName: "Replication",
    sectionId: "60",
    mastered: false,
    concepts: ["Leader-follower replication"],
    reading,
    n: 2,
    of: 3,
  });
  const html = await render();
  expect(pathNext).toHaveBeenCalledWith("u1");
  const items = html.split("<li").slice(1);
  const pathAt = items.findIndex((li) => li.includes("Next in your path"));
  const firstCard = items.findIndex((li) => li.includes('data-item="10"'));
  expect(pathAt).toBeGreaterThanOrEqual(0);
  expect(pathAt).toBeLessThan(firstCard);
  expect(html.replace(/<[^>]+>/g, "")).toContain(
    "Next in your path: Replication",
  );
  expect(html).toContain(
    "Leader-follower replication · reading 2 of 3 · 4 min",
  );
  expect(html).toContain('href="/read/50?from=path&amp;path=6"');
  // The ranked cards keep their positions.
  expect(html).toContain("item=11&amp;pos=2");
  // The right rail links the path, and the review queue, now both live.
  const rail = html.slice(html.indexOf('aria-label="At a glance"'));
  expect(rail).toMatch(/href="\/paths\/6"[^]*?Your path[^]*?Replication/);
  expect(rail).toMatch(/href="\/library#review-queue"[^]*?Nothing due/);
  expect(rail).not.toMatch(/Your path<\/span><span[^>]*>Coming later/);
});

test("a checkpoint ready to take is the first card; none without a next step", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([]));
  pathNext.mockResolvedValueOnce({
    kind: "checkpoint",
    pathId: "6",
    pathName: "Replication",
    sectionId: "60",
    concepts: ["Quorums"],
    size: 5,
    passMark: 4,
    next: ["Leases"],
  });
  // Alone on an empty feed, as the review is.
  const html = await render();
  expect(html).toContain("Nothing to read yet.");
  expect(html).toContain("Checkpoint · Quorums");
  expect(html).toContain("Pass 4 of 5 to unlock Leases.");
  expect(html).toMatch(
    /name="sectionId" value="60"[^]*?name="back" value="\/"[^]*?Take the checkpoint/,
  );
  getFeed.mockResolvedValue(feedOf([card]));
  expect(await render()).not.toContain("Next in your path");
});

test("a path card on a section you've mastered offers to skip it (Q-P2-29)", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  pathNext.mockResolvedValueOnce({
    kind: "reading",
    pathId: "6",
    pathName: "Replication",
    sectionId: "60",
    mastered: true,
    concepts: ["Leader-follower replication"],
    reading,
    n: 1,
    of: 2,
  });
  const html = await render();
  expect(html).toContain("You know this");
  expect(html).toMatch(
    /name="sectionId" value="60"[^]*?name="reason" value="mastered"[^]*?name="back" value="\/"/,
  );
});

// P2-W11-S05 (§5F, Q-P2-33): the book read last, after the path's card.
const bookNext = {
  bookId: "7",
  bookTitle: "Designing Data Systems",
  chapterTitle: "Replication",
  sessionId: "72",
  title: "Followers",
  minutes: 6,
  firstPage: 41,
  lastPage: 46,
  place: 9,
  of: 18,
};

test("the next book session is a card after the path's, saying why", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  pathNext.mockResolvedValueOnce({
    kind: "checkpoint",
    pathId: "6",
    pathName: "Replication",
    sectionId: "60",
    concepts: ["Quorums"],
    size: 5,
    passMark: 4,
    next: null,
  });
  nextSession.mockResolvedValueOnce(bookNext);
  const html = await render();
  expect(nextSession).toHaveBeenCalledWith("u1");
  const items = html.split("<li").slice(1);
  const pathAt = items.findIndex((li) => li.includes("Next in your path"));
  const bookAt = items.findIndex((li) => li.includes("Next in your book"));
  const firstCard = items.findIndex((li) => li.includes('data-item="10"'));
  expect(pathAt).toBeGreaterThanOrEqual(0);
  expect([bookAt, firstCard]).toEqual([pathAt + 1, pathAt + 2]);
  expect(html.replace(/<[^>]+>/g, "")).toContain(
    "Next in your book: Designing Data Systems",
  );
  expect(html).toContain("Replication · session 9 of 18 · pages 41–46 · 6 min");
  expect(html).toMatch(/href="\/books\/7\?session=72"[^>]*>Read Followers/);
  expect(html).toContain("item=10&amp;pos=1");
});

test("without a path the book card comes first; an empty feed still shows it", async () => {
  current.mockResolvedValue(user);
  getFeed.mockResolvedValue(feedOf([card]));
  nextSession.mockResolvedValue(bookNext);
  const items = (await render()).split("<li").slice(1);
  const bookAt = items.findIndex((li) => li.includes("Next in your book"));
  expect(bookAt).toBeGreaterThanOrEqual(0);
  expect(items[bookAt + 1]).toContain('data-item="10"');
  getFeed.mockResolvedValue(feedOf([]));
  const html = await render();
  expect(html).toContain("Nothing to read yet.");
  expect(html).toContain("Next in your book");
  nextSession.mockReset();
  nextSession.mockResolvedValue(null);
  expect(await render()).not.toContain("Next in your book");
});

// ADR-0029: guests play, and only play; Home is for accounts.
test("a guest is sent to sign up before anything is read", async () => {
  current.mockResolvedValue(guest);
  await expect(render()).rejects.toThrow("redirect:/sign-up");
  expect(getFeed).not.toHaveBeenCalled();
});

// ADR-0058: Also fits sized its cards to the break; with no break length it is gone,
// and the challenge and the review stay in the sideways feed on every screen.
test("there is no Also fits grid; the challenge and the review are in the feed everywhere", async () => {
  current.mockResolvedValue(user);
  // An earlier test leaves a plan without the challenge in place.
  can.mockImplementation(() => Promise.resolve(true));
  getFeed.mockResolvedValue(feedOf([card, other("11")]));
  dailyStatus.mockResolvedValueOnce({
    today: "open",
    streak: { days: 2, freezes: 0 },
  });
  dueReviews.mockResolvedValueOnce([
    { conceptId: "1", name: "Raft", daysSince: 1 },
  ]);
  const html = await render();
  expect(html).not.toContain("also-fits");
  expect(html).not.toContain("Also fits");
  const items = html.split("<li");
  const review = items.find((li) => li.includes("Review 1 concept"));
  expect(review).toBeDefined();
  expect(review).not.toMatch(/^[^>]*lg:hidden/);
  const daily = items.find((li) => li.includes("Start today&#x27;s challenge"));
  expect(daily).toBeDefined();
  expect(daily).not.toMatch(/^[^>]*lg:hidden/);
});
