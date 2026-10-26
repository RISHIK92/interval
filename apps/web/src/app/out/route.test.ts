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

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };
const context = { ...guest, sessionId: "visit-1" };

afterEach(() => {
  vi.clearAllMocks();
});

async function open(query: string) {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost:3100/out?${query}`));
}

describe("each link type lands where it points, attributed", () => {
  test.each([
    [
      "anchor",
      "https://pub.test/post#raft",
      "https://pub.test/post?utm_source=interval#raft",
    ],
    [
      "text_fragment",
      "https://pub.test/post#:~:text=Raft%20in%20practice",
      "https://pub.test/post?utm_source=interval#:~:text=Raft%20in%20practice",
    ],
    [
      "page_top",
      "https://pub.test/post",
      "https://pub.test/post?utm_source=interval",
    ],
    [
      "article",
      "https://pub.test/post?ref=feed",
      "https://pub.test/post?ref=feed&utm_source=interval",
    ],
    // The publisher's own query is kept byte for byte: re-encoding could change it.
    [
      "article",
      "https://pub.test/post?q=a%20b&flag&x=a/b",
      "https://pub.test/post?q=a%20b&flag&x=a/b&utm_source=interval",
    ],
  ] as const)("%s", async (linkType, stored, expected) => {
    current.mockResolvedValue(guest);
    resolve.mockResolvedValue({ url: stored, linkType });
    const moment = linkType === "article" ? "" : "&moment=9";
    const response = await open(
      `item=5${moment}&chip=3-8&pos=4&target=section`,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(expected);
    expect(resolve).toHaveBeenCalledWith(
      "5",
      linkType === "article" ? null : "9",
    );
    expect(emit).toHaveBeenCalledWith(
      "card_opened",
      {
        kind: linkType === "article" ? "article" : "moment",
        chip: "3-8",
        position: 4,
      },
      context,
    );
    expect(emit).toHaveBeenCalledWith(
      "outbound_click",
      { link_type: linkType, target: "section" },
      context,
    );
  });
});

test("Open original website goes to the page itself, not the section", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post",
    linkType: "article",
  });
  const response = await open("item=5&moment=9&chip=3-8&pos=1&target=original");
  expect(resolve).toHaveBeenCalledWith("5", null);
  expect(response.headers.get("location")).toBe(
    "https://pub.test/post?utm_source=interval",
  );
  expect(emit).toHaveBeenCalledWith(
    "card_opened",
    { kind: "moment", chip: "3-8", position: 1 },
    context,
  );
  expect(emit).toHaveBeenCalledWith(
    "outbound_click",
    { link_type: "article", target: "original" },
    context,
  );
});

test.each([
  ["a bad item id", "item=5x&chip=3-8&pos=1&target=section"],
  ["a bad moment id", "item=5&moment=abc&chip=3-8&pos=1&target=section"],
  ["a bad chip", "item=5&chip=2-4&pos=1&target=section"],
  ["a bad target", "item=5&chip=3-8&pos=1&target=elsewhere"],
  ["a position of 0", "item=5&chip=3-8&pos=0&target=section"],
  ["a position past 200", "item=5&chip=3-8&pos=201&target=section"],
])("%s goes home without a lookup or events", async (_name, query) => {
  current.mockResolvedValue(guest);
  const response = await open(query);
  expect(response.status).toBe(302);
  // Relative: behind the proxy the app sees http, and must not downgrade the reader.
  expect(response.headers.get("location")).toBe("/");
  expect(resolve).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test("an unknown item goes home with no events", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue(null);
  const response = await open("item=5&chip=3-8&pos=1&target=section");
  expect(response.headers.get("location")).toBe("/");
  expect(emit).not.toHaveBeenCalled();
});

test("a URL in the query is never followed: only the stored one is", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post",
    linkType: "article",
  });
  const response = await open(
    "item=5&chip=3-8&pos=1&target=original&url=https://evil.test&to=https://evil.test",
  );
  expect(response.headers.get("location")).toBe(
    "https://pub.test/post?utm_source=interval",
  );
});

test.each(["javascript:alert(1)", "data:text/html,hi", "/relative/path"])(
  "a stored link that isn't http(s) (%s) is never sent; the reader goes home",
  async (stored) => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    current.mockResolvedValue(guest);
    resolve.mockResolvedValue({ url: stored, linkType: "article" });
    const response = await open("item=5&chip=3-8&pos=1&target=original");
    expect(response.headers.get("location")).toBe("/");
    expect(emit).not.toHaveBeenCalled();
  },
);

test("without a session the reader still reaches the publisher, unrecorded", async () => {
  current.mockResolvedValue(null);
  resolve.mockResolvedValue({
    url: "https://pub.test/post",
    linkType: "article",
  });
  const response = await open("item=5&chip=3-8&pos=1&target=original");
  expect(response.headers.get("location")).toBe(
    "https://pub.test/post?utm_source=interval",
  );
  expect(emit).not.toHaveBeenCalled();
});

// P1-W5-S02: the feed's "Now reading" panel knows what was opened.
test("an open is remembered for the session's Now reading panel", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post#raft",
    linkType: "anchor",
  });
  await open("item=5&moment=9&chip=3-8&pos=1&target=section");
  const [name, value, options] = setCookie.mock.calls[0] as [
    string,
    string,
    Record<string, unknown>,
  ];
  expect([name, value]).toEqual(["iv_reading", "5.9"]);
  expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  expect(options["maxAge"]).toBeUndefined();
  setCookie.mockClear();
  await open("item=5&chip=3-8&pos=1&target=original");
  expect(setCookie.mock.calls[0]?.[1]).toBe("5.");
});

test("without a session nothing is remembered", async () => {
  current.mockResolvedValue(null);
  resolve.mockResolvedValue({
    url: "https://pub.test/post",
    linkType: "article",
  });
  await open("item=5&chip=3-8&pos=1&target=original");
  expect(setCookie).not.toHaveBeenCalled();
});

test("an open that fell back to the article page is remembered as the article", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post",
    linkType: "article",
  });
  await open("item=5&moment=9&chip=3-8&pos=1&target=section");
  expect(setCookie.mock.calls[0]?.[1]).toBe("5.");
});

// Owner, 2026-10-26: Continue after a finish counts as continue_clicked, not a card.
test("a Continue link counts as continue_clicked, not as a feed card", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post#raft",
    linkType: "anchor",
  });
  const response = await open(
    "item=5&moment=9&chip=3-8&from=continue&target=section",
  );
  expect(response.headers.get("location")).toBe(
    "https://pub.test/post?utm_source=interval#raft",
  );
  expect(emit).toHaveBeenCalledWith("continue_clicked", {}, context);
  expect(emit).toHaveBeenCalledWith(
    "outbound_click",
    { link_type: "anchor", target: "section" },
    context,
  );
  expect(emit.mock.calls.map((c) => c[0] as string)).not.toContain(
    "card_opened",
  );
});

// P1-W5-S03: an open section counts for continue cards (owner, 2026-10-26).
test("an opened section is recorded; a whole article or fallback is not", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post#raft",
    linkType: "anchor",
  });
  await open("item=5&moment=9&chip=3-8&pos=1&target=section");
  expect(recordOpen).toHaveBeenCalledExactlyOnceWith("g1", "5", "9");
  recordOpen.mockClear();
  resolve.mockResolvedValue({
    url: "https://pub.test/post",
    linkType: "article",
  });
  await open("item=5&moment=9&chip=3-8&pos=1&target=section");
  await open("item=5&moment=9&chip=3-8&pos=1&target=original");
  expect(recordOpen).not.toHaveBeenCalled();
});

// P1-W5-S03: a feed card's open counts toward its exploration arm, if it had one.
test("a feed card's open is counted for exploration; a Continue open is not", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post#raft",
    linkType: "anchor",
  });
  await open("item=5&moment=9&chip=3-8&pos=1&target=section");
  expect(countExploreOpen).toHaveBeenCalledExactlyOnceWith(
    "g1",
    "3-8",
    "5",
    "9",
  );
  countExploreOpen.mockClear();
  await open("item=5&moment=9&chip=3-8&from=continue&target=section");
  expect(countExploreOpen).not.toHaveBeenCalled();
});

test("an article card's open is counted for its whole-article entry", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post",
    linkType: "article",
  });
  await open("item=5&chip=8-15&pos=2&target=original");
  expect(countExploreOpen).toHaveBeenCalledExactlyOnceWith(
    "g1",
    "8-15",
    "5",
    null,
  );
});

// P1-W5-S05 (owner): a Library open is attributed and counts as an outbound click only.
test("a Library open records outbound_click only, and needs no chip", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post",
    linkType: "article",
  });
  const response = await open("item=5&from=library&target=original");
  expect(response.headers.get("location")).toBe(
    "https://pub.test/post?utm_source=interval",
  );
  expect(emit.mock.calls.map((c) => c[0] as string)).toEqual([
    "outbound_click",
  ]);
  expect(countExploreOpen).not.toHaveBeenCalled();
});

test("a continue open needs no chip; a feed card without one goes home", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post#raft",
    linkType: "anchor",
  });
  const cont = await open("item=5&moment=9&from=continue&target=section");
  expect(cont.headers.get("location")).toBe(
    "https://pub.test/post?utm_source=interval#raft",
  );
  emit.mockClear();
  const card = await open("item=5&moment=9&pos=1&target=section");
  expect(card.headers.get("location")).toBe("/");
  expect(emit).not.toHaveBeenCalled();
});

test.each([
  [
    "from with a position",
    "item=5&moment=9&from=continue&pos=1&target=section",
  ],
  [
    "a Library open with chip and position",
    "item=5&from=library&chip=3-8&pos=1&target=original",
  ],
  ["no from, no chip, no position", "item=5&target=original"],
  ["a chip with no position and no from", "item=5&chip=3-8&target=original"],
  [
    "a Library open naming a section",
    "item=5&moment=9&from=library&target=section",
  ],
])("%s goes home without a lookup", async (_name, query) => {
  current.mockResolvedValue(guest);
  const response = await open(query);
  expect(response.headers.get("location")).toBe("/");
  expect(resolve).not.toHaveBeenCalled();
});

// Owner, 2026-10-26: Now reading is about what the feed sent you to.
test("a Library open doesn't feed the Now reading panel", async () => {
  current.mockResolvedValue(guest);
  resolve.mockResolvedValue({
    url: "https://pub.test/post",
    linkType: "article",
  });
  await open("item=5&from=library&target=original");
  expect(setCookie).not.toHaveBeenCalled();
});
