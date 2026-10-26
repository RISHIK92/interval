import { afterEach, describe, expect, test, vi } from "vitest";
import type { Actor, OutboundLinks } from "../../server/ports";

// §3.2, §5D, §8, P1-W5-S01: a card's link records the open, then goes to the publisher.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const resolve = vi.fn<OutboundLinks["resolve"]>();
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  outboundLinks: () => ({ resolve }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
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
