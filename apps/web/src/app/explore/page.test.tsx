import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Actor, Asks, Explore, Preferences } from "../../server/ports";

// ADR-0046 (Explore, web): one box to ask or search, the gap card, the user's spaces
// and "Saved most this week", with fakes for every port (ADR-0012).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get =
  vi.fn<
    (
      userId: string,
    ) => Promise<(Preferences & { firstName: string | null }) | null>
  >();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const search = vi.fn<Explore["search"]>(() => Promise.resolve([]));
const gap = vi.fn<Explore["gap"]>(() => Promise.resolve(null));
const spaces = vi.fn<Explore["spaces"]>(() =>
  Promise.resolve([
    { topic: "system-design", learners: 6800, fresh: 9 },
    { topic: "databases", learners: 12, fresh: 0 },
    { topic: "distributed-systems", learners: 3249, fresh: 12 },
    { topic: "backend", learners: 51, fresh: 0 },
    { topic: "software-design", learners: 0, fresh: 0 },
  ]),
);
const savedMost = vi.fn<Explore["savedMost"]>(() => Promise.resolve([]));
const latest = vi.fn<Asks["latest"]>(() => Promise.resolve(null));
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get }),
  entitlements: () => ({ can }),
  explore: () => ({ search, gap, spaces, savedMost }),
  asks: () => ({ latest }),
  events: () => ({ emit }),
  // ADR-0049: software design isn't offered yet.
  feedReader: () => ({ topicsWithReading: () => Promise.resolve([]) }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("./actions", () => ({
  followSpaceAction: vi.fn(),
  dismissGapAction: vi.fn(),
}));

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: null };

beforeEach(() => {
  current.mockResolvedValue(ada);
  can.mockResolvedValue(true);
  get.mockResolvedValue({
    goals: ["stay-sharp"],
    topics: ["distributed-systems", "databases"],
    level: "intermediate",
    firstName: "Ada",
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

async function page(params: Record<string, string> = {}): Promise<string> {
  const { default: ExplorePage } = await import("./page");
  return renderToStaticMarkup(
    await ExplorePage({ searchParams: Promise.resolve(params) }),
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, "");

test("guests and the signed-out are sent away; Explore is the current tab", async () => {
  current.mockResolvedValueOnce({ ...ada, isGuest: true });
  await expect(page()).rejects.toThrow("redirect:/sign-up");
  current.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("redirect:/join");
  const html = await page();
  expect(html).toMatch(/<h1[^>]*>Explore<\/h1>/);
  expect(html).toMatch(
    /<a(?=[^>]*href="\/explore")(?=[^>]*aria-current="page")/,
  );
});

test("Ask and its chips show only with explore.ask; search always does", async () => {
  const asking = await page();
  expect(asking).toContain(
    'placeholder="Ask anything, or search your library"',
  );
  for (const chip of [
    "Compare two things",
    "Explain like I’m new",
    "Interview drill",
    "Use my stack as the example",
  ])
    expect(asking).toContain(chip);
  // No voice input (Q-WD-22).
  expect(asking).not.toMatch(/voice/i);
  can.mockResolvedValue(false);
  const searching = await page();
  expect(searching).toContain('placeholder="Search your library"');
  expect(searching).not.toContain("Interview drill");
  expect(latest).toHaveBeenCalledTimes(1);
});

test("a search lists article links, and counts itself without the query", async () => {
  search.mockResolvedValueOnce([
    {
      itemId: "5",
      articleTitle: "Designing data systems",
      sourceName: "DDIA",
      author: null,
      minutes: 6,
      saved: true,
      note: "Ask about rebalancing",
    },
  ]);
  const html = await page({ q: "  sharding  " });
  expect(search).toHaveBeenCalledWith("u1", "sharding", 20);
  expect(text(html)).toContain("Results for “sharding”");
  expect(html).toContain(
    'href="/out?item=5&amp;from=explore&amp;target=article"',
  );
  // ADR-0058: the result is the article itself.
  expect(text(html)).toContain("Designing data systems");
  expect(text(html)).toContain("DDIA · 6 min · Saved");
  expect(text(html)).toContain("Your note: Ask about rebalancing");
  expect(emit).toHaveBeenCalledWith(
    "explore_searched",
    { result_count: 1 },
    expect.objectContaining({ userId: "u1" }),
  );
  expect(JSON.stringify(emit.mock.calls)).not.toContain("sharding");
});

test("no query, no search and no event", async () => {
  await page();
  expect(search).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test("the gap card names what the user knows and opens its shortest article", async () => {
  gap.mockResolvedValueOnce({
    conceptId: "77",
    concept: "Consistency models",
    topic: "distributed-systems",
    known: ["Caching", "Replication"],
    itemId: "5",
    minutes: 6,
  });
  const html = await page();
  expect(text(html)).toContain(
    "You know Caching and Replication. The idea that connects them is Consistency models.",
  );
  expect(html).toContain('href="/explore/gap?concept=77"');
  expect(text(html)).toContain("Close the gap · 6 min");
  expect(html).toContain('name="concept" value="77"');
});

test("your spaces are the followed topics; learners show only above 50", async () => {
  const html = text(await page());
  expect(html).toContain("#distributed3.2k learners12 new");
  // 12 learners: no count, the topic's name instead.
  expect(html).toContain("#databasesDatabases");
  expect(html).not.toContain("#system-design");
  expect(html).toContain("Find more");
});

test("Find more lists every offered space with Follow and Unfollow", async () => {
  const html = await page({ spaces: "all" });
  for (const tag of [
    "#system-design",
    "#databases",
    "#distributed",
    "#backend",
  ])
    expect(text(html)).toContain(tag);
  // ADR-0049: not offered and not followed.
  expect(text(html)).not.toContain("#software-design");
  expect(text(html)).toContain("51 learners");
  expect(html.match(/>Unfollow</g)).toHaveLength(2);
  expect(html.match(/>Follow</g)).toHaveLength(2);
});

test("saved most this week has its tabs and says why it's empty", async () => {
  const html = await page({ tab: "new" });
  expect(savedMost).toHaveBeenCalledWith(
    "u1",
    "new",
    ["distributed-systems", "databases"],
    expect.any(Date),
  );
  expect(html).toMatch(
    /<a(?=[^>]*href="\/explore\?tab=new")(?=[^>]*aria-current="true")/,
  );
  expect(text(html)).toContain("Saved most this week");
  expect(text(html)).toContain(
    "Nothing here has been saved by 5 people this week yet.",
  );
});

test("the last answer is labelled AI and its sources are the cited deep links", async () => {
  latest.mockResolvedValueOnce({
    id: "11111111-1111-4111-8111-111111111111",
    text: "When should I shard?",
    chip: null,
    askedAt: new Date(),
    depth: 0,
    answer: {
      outcome: "answered",
      text: "Shard when one node cannot hold your writes. [m9] Replicas come first. [m9, c3]",
      citations: [
        {
          kind: "reading",
          passage: "m9",
          itemId: "5",
          label: "DDIA · Designing data systems",
          topic: "distributed-systems",
        },
        {
          kind: "explainer",
          passage: "c3",
          label: "Explainer · Sharding",
          topic: "databases",
        },
      ],
    },
  });
  const html = await page();
  expect(text(html)).toContain("You asked · “When should I shard?”");
  expect(html).toMatch(/>AI<\/span>/);
  expect(text(html)).toContain(
    "Shard when one node cannot hold your writes.1 Replicas come first.1,2",
  );
  expect(html).toContain(
    'href="/out?item=5&amp;from=explore&amp;target=article"',
  );
  expect(text(html)).toContain("Explainer · Sharding");
  expect(text(html)).toContain("Ask a follow-up");
  expect(html).toContain(
    'href="/explore/session?question=11111111-1111-4111-8111-111111111111"',
  );
  expect(text(html)).toContain("Make it a reading session");
});

test("an answer nothing covered says so and offers the search", async () => {
  latest.mockResolvedValueOnce({
    id: "11111111-1111-4111-8111-111111111111",
    text: "Who won the 1998 World Cup?",
    chip: null,
    askedAt: new Date(),
    depth: 0,
    answer: { outcome: "nothing_found", text: null, citations: [] },
  });
  const html = await page();
  expect(text(html)).toContain("Nothing in your library covers this yet.");
  expect(html).toContain(
    'href="/explore?q=Who%20won%20the%201998%20World%20Cup%3F"',
  );
  expect(text(html)).not.toContain("Ask a follow-up");
  expect(text(html)).not.toContain("Make it a reading session");
});
