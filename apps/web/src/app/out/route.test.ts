import { afterEach, describe, expect, test, vi } from "vitest";
import type { Actor, OutboundLinks, Progress } from "../../server/ports";

// §3.2, §5D, §8, P1-W5-S01: a card's link records the open, then goes to the publisher.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const resolve = vi.fn<OutboundLinks["resolve"]>();
const emit = vi.fn();
const recordOpen = vi.fn<Progress["recordOpen"]>(() => Promise.resolve());
const countExploreOpen = vi.fn<Progress["countExploreOpen"]>(() =>
  Promise.resolve(),
);
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  outboundLinks: () => ({ resolve }),
  progress: () => ({ recordOpen, countExploreOpen }),
  events: () => ({ emit }),
}));
const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
      set: setCookie,
    }),
}));
vi.mock("../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "http://localhost:3100" }),
}));

const user: Actor = { userId: "g1", isGuest: false, betaGroup: "student" };
const guest: Actor = { ...user, isGuest: true };
const context = { ...user, sessionId: "visit-1" };

afterEach(() => {
  vi.clearAllMocks();
});

async function open(query: string) {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost:3100/out?${query}`));
}

// ADR-0058: every link is the article's own page. A section, chip or the old
// "section" target from a page or app built before it is ignored.
const ARTICLE = { url: "https://pub.test/post", linkType: "article" } as const;

describe("the article's page, attributed", () => {
  test.each([
    ["https://pub.test/post", "https://pub.test/post?utm_source=interval"],
    // The publisher's own query is kept byte for byte: re-encoding could change it.
    [
      "https://pub.test/post?q=a%20b&flag&x=a/b",
      "https://pub.test/post?q=a%20b&flag&x=a/b&utm_source=interval",
    ],
  ])("%s", async (stored, expected) => {
    current.mockResolvedValue(user);
    resolve.mockResolvedValue({ url: stored, linkType: "article" });
    const response = await open("item=5&pos=4&target=article");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(expected);
    expect(resolve).toHaveBeenCalledWith("5");
    expect(emit).toHaveBeenCalledWith(
      "card_opened",
      {
        position: 4,
        // The id matches an open to its completion (P1-W6-S04).
        item_id: "5",
        surface: "browser", // ADR-0018: /out opens the publisher's page in the browser
        via: "feed",
      },
      context,
    );
    expect(emit).toHaveBeenCalledWith(
      "outbound_click",
      { target: "article" },
      context,
    );
  });
});

test("an older link's section, chip and section target are ignored", async () => {
  current.mockResolvedValue(user);
  resolve.mockResolvedValue(ARTICLE);
  const response = await open(
    "item=5&moment=abc&chip=2-4&pos=1&target=section",
  );
  expect(response.headers.get("location")).toBe(
    "https://pub.test/post?utm_source=interval",
  );
  expect(resolve).toHaveBeenCalledWith("5");
  expect(emit).toHaveBeenCalledWith(
    "outbound_click",
    { target: "article" },
    context,
  );
});

test("Open original website is counted as such", async () => {
  current.mockResolvedValue(user);
  resolve.mockResolvedValue(ARTICLE);
  await open("item=5&pos=1&target=original");
  expect(emit).toHaveBeenCalledWith(
    "outbound_click",
    { target: "original" },
    context,
  );
});

test.each([
  ["a bad item id", "item=5x&pos=1&target=article"],
  ["a bad target", "item=5&pos=1&target=elsewhere"],
  ["a position of 0", "item=5&pos=0&target=article"],
  ["a position past 200", "item=5&pos=201&target=article"],
  ["from with a position", "item=5&from=continue&pos=1&target=article"],
  ["no from and no position", "item=5&target=original"],
  ["a forged via", "item=5&pos=2&via=vscode&target=article"],
])("%s goes home without a lookup or events", async (_name, query) => {
  current.mockResolvedValue(user);
  const response = await open(query);
  expect(response.status).toBe(302);
  // Relative: behind the proxy the app sees http, and must not downgrade the reader.
  expect(response.headers.get("location")).toBe("/");
  expect(resolve).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test("an unknown item goes home with no events", async () => {
  current.mockResolvedValue(user);
  resolve.mockResolvedValue(null);
  const response = await open("item=5&pos=1&target=article");
  expect(response.headers.get("location")).toBe("/");
  expect(emit).not.toHaveBeenCalled();
});

test("a URL in the query is never followed: only the stored one is", async () => {
  current.mockResolvedValue(user);
  resolve.mockResolvedValue(ARTICLE);
  const response = await open(
    "item=5&pos=1&target=original&url=https://evil.test&to=https://evil.test",
  );
  expect(response.headers.get("location")).toBe(
    "https://pub.test/post?utm_source=interval",
  );
});

test.each(["javascript:alert(1)", "data:text/html,hi", "/relative/path"])(
  "a stored link that isn't http(s) (%s) is never sent; the reader goes home",
  async (stored) => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    current.mockResolvedValue(user);
    resolve.mockResolvedValue({ url: stored, linkType: "article" });
    const response = await open("item=5&pos=1&target=original");
    expect(response.headers.get("location")).toBe("/");
    expect(emit).not.toHaveBeenCalled();
  },
);

test("without a session the reader still reaches the publisher, unrecorded", async () => {
  current.mockResolvedValue(null);
  resolve.mockResolvedValue(ARTICLE);
  const response = await open("item=5&pos=1&target=original");
  expect(response.headers.get("location")).toBe(
    "https://pub.test/post?utm_source=interval",
  );
  expect(emit).not.toHaveBeenCalled();
  expect(setCookie).not.toHaveBeenCalled();
  expect(recordOpen).not.toHaveBeenCalled();
});

// P1-W5-S02: the feed's "Now reading" panel knows what was opened: the article.
test("an open is remembered for the session's Now reading panel", async () => {
  current.mockResolvedValue(user);
  resolve.mockResolvedValue(ARTICLE);
  await open("item=5&moment=9&pos=1&target=article");
  const [name, value, options] = setCookie.mock.calls[0] as [
    string,
    string,
    Record<string, unknown>,
  ];
  expect([name, value]).toEqual(["iv_reading", "5"]);
  expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  expect(options["maxAge"]).toBeUndefined();
});

// ADR-0058: any open makes the article Continue reading; only a feed card's counts
// toward its exploration arm (P1-W5-S03).
test("a feed card's open is recorded and counted for exploration", async () => {
  current.mockResolvedValue(user);
  resolve.mockResolvedValue(ARTICLE);
  await open("item=5&pos=1&target=article");
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5");
  expect(countExploreOpen).toHaveBeenCalledExactlyOnceWith("g1", "5");
});

// Owner, 2026-10-26: Continue counts as continue_clicked, not a card.
test("a Continue link counts as continue_clicked, not as a feed card", async () => {
  current.mockResolvedValue(user);
  resolve.mockResolvedValue(ARTICLE);
  await open("item=5&from=continue&target=article");
  expect(emit).toHaveBeenCalledWith("continue_clicked", {}, context);
  expect(emit.mock.calls.map((c) => c[0] as string)).not.toContain(
    "card_opened",
  );
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5");
  expect(countExploreOpen).not.toHaveBeenCalled();
  expect(setCookie).toHaveBeenCalled();
});

// P1-W5-S05, P2-W10-S03, ADR-0046 (owner): Library, path and Explore opens are an
// outbound click only, still recorded as opened, without the Now reading cookie; a
// move inside the reader (ADR-0018) keeps the cookie.
test.each(["library", "path", "explore", "reader"] as const)(
  "a %s open records the outbound click only",
  async (from) => {
    current.mockResolvedValue(user);
    resolve.mockResolvedValue(ARTICLE);
    const response = await open(`item=5&from=${from}&target=article`);
    expect(response.headers.get("location")).toBe(
      "https://pub.test/post?utm_source=interval",
    );
    expect(emit.mock.calls.map((c) => c[0] as string)).toEqual([
      "outbound_click",
    ]);
    expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5");
    expect(countExploreOpen).not.toHaveBeenCalled();
    expect(setCookie.mock.calls.length).toBe(from === "reader" ? 1 : 0);
  },
);

// ADR-0029: a guest (from a sprint's Read again) reaches the publisher, and only the
// outbound click is recorded: no reading progress, no Now reading panel.
test("a guest's open records the outbound click only", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue(ARTICLE);
  const response = await open("item=5&from=reader&target=article");
  expect(response.headers.get("location")).toContain("pub.test/post");
  expect(recordOpen).not.toHaveBeenCalled();
  expect(setCookie).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "outbound_click",
    { target: "article" },
    { ...guest, sessionId: "visit-1" },
  );
});

// P7-W46 (owner, 2026-11-27): a suggestion a companion surface showed is counted as an
// open offered there.
test("a companion's suggestion is an open via the agent", async () => {
  current.mockResolvedValue(user);
  resolve.mockResolvedValue(ARTICLE);
  await open("item=5&chip=1-3&pos=2&via=agent&target=article");
  expect(emit).toHaveBeenCalledWith(
    "card_opened",
    { position: 2, item_id: "5", surface: "browser", via: "agent" },
    context,
  );
});
