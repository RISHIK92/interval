import { ReaderResponse } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, ReaderPage } from "../../../../server/ports";

// P4-W20-S02 (ADR-0018, §3.2): the app's reader reads what the web reader shows around
// the publisher's page, and counts the open as the web does, from the app. ADR-0058:
// always the whole article.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const reader = vi.fn<() => Promise<ReaderPage | null>>();
const onItems = vi.fn(() =>
  Promise.resolve([
    { itemId: "5", sectionTitle: null, body: "Mine." },
    { itemId: "5", sectionTitle: "Leader election", body: "Terms." },
  ]),
);
const countOpen = vi.fn(() => Promise.resolve());
const offered = vi.fn(() => Promise.resolve(new Set(["5"])));
const emit = vi.fn();
const voiced = vi.fn(() => Promise.resolve(["7"]));
vi.mock("../../../../server/container", () => ({
  events: () => ({ emit }),
  sessionReader: () => ({ current }),
  outboundLinks: () => ({ reader }),
  notes: () => ({ onItems }),
  quizzes: () => ({ offered }),
  listening: () => ({ voiced }),
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
  link: { url: "https://www.blog.dev/raft", linkType: "article" },
  frameable: false,
  articleTitle: "Raft",
  sourceName: "A blog",
  reasons: null,
  saved: true,
  state: "continue_reading",
  estimatedMinutes: 6,
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

test("a feed card's open: the article, attributed, in the app even if it can't be framed", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue(page);
  const response = await get("?pos=2");
  expect(response.status).toBe(200);
  expect(ReaderResponse.parse(await response.json())).toEqual({
    url: "https://www.blog.dev/raft?utm_source=interval",
    inApp: true,
    title: "Raft",
    domain: "blog.dev",
    saved: true,
    state: "continue_reading",
    note: "Mine.",
    // ADR-0058: notes written on a section before it, under the article.
    sectionNotes: [{ sectionTitle: "Leader election", body: "Terms." }],
    testable: true,
    listen: true,
    // P4-W20-S03: the whole page, read through for about its minutes.
    measure: { minutes: 6 },
  });
  expect(reader).toHaveBeenCalledWith("u1", "5");
  expect(onItems).toHaveBeenCalledWith("u1", ["5"]);
  expect(offered).toHaveBeenCalledWith(["5"]);
  expect(voiced).toHaveBeenCalledWith("5");
  expect(countOpen).toHaveBeenCalledWith(
    expect.objectContaining({ source: "ios", sessionId: null }),
    {
      itemId: "5",
      card: { pos: 2, via: "feed" },
      from: undefined,
      surface: "in_app",
    },
  );
  expect(emit).not.toHaveBeenCalled();
});

// An app from before ADR-0058 still sends its section and chip: both are ignored.
test("an older app's section and chip are ignored", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue(page);
  expect((await get("?moment=9&chip=3-8&pos=2")).status).toBe(200);
  expect(reader).toHaveBeenCalledWith("u1", "5");
  expect(countOpen).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ card: { pos: 2, via: "feed" } }),
  );
});

test("a link without a card is from=reader; a page not on https is a browser open and an outbound click", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue({
    ...page,
    link: { url: "http://blog.dev/raft", linkType: "article" },
  });
  const body = ReaderResponse.parse(await (await get("")).json());
  // Not https: the browser, as the web's /out, so nothing to measure.
  expect(body).toMatchObject({ inApp: false, title: "Raft", measure: null });
  expect(countOpen).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ card: null, from: "reader", surface: "browser" }),
  );
  expect(emit).toHaveBeenCalledWith(
    "outbound_click",
    { target: "article" },
    expect.objectContaining({ source: "ios" }),
  );
});

test("an article of unknown length has nothing to measure", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue({ ...page, estimatedMinutes: null });
  const body = ReaderResponse.parse(await (await get("")).json());
  expect(body.measure).toBeNull();
});

test("a guest, another site, a bad query or an unknown item: refused", async () => {
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await get("")).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await get("", {})).status).toBe(403);
  expect((await get("?pos=0")).status).toBe(400);
  reader.mockResolvedValue(null);
  expect((await get("")).status).toBe(404);
  expect(countOpen).not.toHaveBeenCalled();
});

test("no live question on the article: Quiz me isn't offered", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue(page);
  offered.mockResolvedValueOnce(new Set());
  const body = ReaderResponse.parse(await (await get("?pos=2")).json());
  expect(body.testable).toBe(false);
});

// P4-W23-S02: Listen in the app, as on the web, once something here is voiced.
test("nothing voiced on the article: no Listen", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue(page);
  voiced.mockResolvedValueOnce([]);
  const body = ReaderResponse.parse(await (await get("?pos=2")).json());
  expect(body.listen).toBe(false);
});

// P4-W21-S03 (§5F): a path's reading counts as the web's from=path, never a card.
test("a path's reading is from=path; a path and a card at once is refused", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue(page);
  expect((await get("?path=3")).status).toBe(200);
  expect(countOpen).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ card: null, from: "path" }),
  );
  expect((await get("?path=3&pos=1")).status).toBe(400);
});
