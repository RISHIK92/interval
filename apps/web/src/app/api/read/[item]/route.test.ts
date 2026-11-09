import { ReaderResponse } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, ReaderPage } from "../../../../server/ports";

// P4-W20-S02 (ADR-0018, §3.2): the app's reader reads what the web reader shows around
// the publisher's page, and counts the open as the web does, from the app.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const reader = vi.fn<() => Promise<ReaderPage | null>>();
const noteOf = vi.fn(() => Promise.resolve<string | null>("Mine."));
const countOpen = vi.fn(() => Promise.resolve());
const offered = vi.fn(() => Promise.resolve(new Set(["5.9"])));
const emit = vi.fn();
vi.mock("../../../../server/container", () => ({
  events: () => ({ emit }),
  sessionReader: () => ({ current }),
  outboundLinks: () => ({ reader }),
  notes: () => ({ get: noteOf }),
  quizzes: () => ({ offered }),
}));
vi.mock("../../../../server/opens", async (actual) => ({
  ...(await actual<typeof import("../../../../server/opens")>()),
  countOpen,
}));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "ios" };
const page: ReaderPage = {
  link: { url: "https://www.blog.dev/raft#election", linkType: "anchor" },
  frameable: false,
  articleTitle: "Raft",
  sectionTitle: "Leader election",
  sourceName: "A blog",
  reasons: null,
  saved: true,
  nextMomentId: "10",
  estimatedMinutes: 6,
  nextLink: "https://www.blog.dev/raft#log-replication",
};

afterEach(() => {
  vi.clearAllMocks();
});

const get = async (query: string, headers: Record<string, string> = APP) => {
  const { GET } = await import("./route");
  return GET(
    new Request(`http://localhost:3100/api/read/5${query}`, { headers }),
    { params: Promise.resolve({ item: "5" }) },
  );
};

test("a feed card's open: the page, attributed, in the app even if it can't be framed", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue(page);
  const response = await get("?moment=9&chip=3-8&pos=2");
  expect(response.status).toBe(200);
  expect(ReaderResponse.parse(await response.json())).toEqual({
    url: "https://www.blog.dev/raft?utm_source=interval#election",
    inApp: true,
    title: "Leader election — Raft",
    domain: "blog.dev",
    saved: true,
    reached: "9",
    nextMomentId: "10",
    note: "Mine.",
    testable: true,
    // P4-W20-S03: from this section's start to the next one's.
    measure: {
      start: { id: "election" },
      end: { id: "log-replication" },
      minutes: 6,
    },
  });
  expect(reader).toHaveBeenCalledWith("u1", "5", "9");
  expect(noteOf).toHaveBeenCalledWith("u1", "5", "9");
  expect(countOpen).toHaveBeenCalledWith(
    expect.objectContaining({ source: "ios", sessionId: null }),
    expect.objectContaining({
      itemId: "5",
      momentId: "9",
      card: { chip: "3-8", pos: 2 },
      from: undefined,
      surface: "in_app",
    }),
  );
  expect(emit).not.toHaveBeenCalled();
});

test("a link without a card is from=reader; a page not on https is a browser open and an outbound click", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue({
    ...page,
    link: { url: "http://blog.dev/raft", linkType: "article" },
    sectionTitle: null,
  });
  const body = ReaderResponse.parse(await (await get("?moment=9")).json());
  // Not https: the browser, as the web's /out.
  expect(body).toMatchObject({
    inApp: false,
    reached: null,
    title: "Raft",
    measure: null,
  });
  expect(noteOf).toHaveBeenCalledWith("u1", "5", null);
  expect(countOpen).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ card: null, from: "reader", surface: "browser" }),
  );
  expect(emit).toHaveBeenCalledWith(
    "outbound_click",
    { link_type: "article", target: "section" },
    expect.objectContaining({ source: "ios" }),
  );
});

test("a guest, another site, a bad query or an unknown item: refused", async () => {
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await get("")).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await get("", {})).status).toBe(403);
  expect((await get("?moment=x")).status).toBe(400);
  expect((await get("?chip=3-8")).status).toBe(400);
  reader.mockResolvedValue(null);
  expect((await get("")).status).toBe(404);
  expect(countOpen).not.toHaveBeenCalled();
});

// P4-W20-S03 (§5D): only a section with a findable start, and an end unless it is last.
test.each([
  [
    "a text fragment, the last section: to the page's end",
    { url: "https://blog.dev/raft#:~:text=Leader%20election", nextLink: null },
    { start: { text: "Leader election" }, end: null, minutes: 6 },
  ],
  [
    "a next section without a marker: nothing to measure",
    {
      url: "https://blog.dev/raft#election",
      nextLink: "https://blog.dev/raft",
    },
    null,
  ],
  [
    "a page-top link: nothing to measure",
    { url: "https://blog.dev/raft", nextLink: null },
    null,
  ],
])("%s", async (_, links, measure) => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue({
    ...page,
    link: {
      url: links.url,
      linkType: links.url.includes("#:~:")
        ? "text_fragment"
        : links.url.includes("#")
          ? "anchor"
          : "page_top",
    },
    nextLink: links.nextLink,
  });
  const body = ReaderResponse.parse(await (await get("?moment=9")).json());
  expect(body.measure).toEqual(measure);
});

test("no live question on what's shown: Test me isn't offered", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue(page);
  offered.mockResolvedValueOnce(new Set());
  const body = ReaderResponse.parse(
    await (await get("?moment=9&chip=3-8&pos=2")).json(),
  );
  expect(body.testable).toBe(false);
  expect(offered).toHaveBeenCalledWith([{ itemId: "5", momentId: "9" }]);
});
