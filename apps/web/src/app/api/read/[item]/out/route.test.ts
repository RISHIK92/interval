import { afterEach, expect, test, vi } from "vitest";
import type { Actor, ReaderPage } from "../../../../../server/ports";

// P4-W20-S02 (§8): the app reader's Open in browser records the click, as /out does.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const reader = vi.fn<() => Promise<ReaderPage | null>>();
const emit = vi.fn();
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  outboundLinks: () => ({ reader }),
  events: () => ({ emit }),
}));
vi.mock("../../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const APP = { "expo-origin": "interval://", "interval-platform": "android" };
const page: ReaderPage = {
  link: { url: "https://blog.dev/raft#election", linkType: "anchor" },
  frameable: true,
  articleTitle: "Raft",
  sectionTitle: "Leader election",
  sourceName: "A blog",
  reasons: null,
  saved: false,
  nextMomentId: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

const post = async (body: unknown, headers: Record<string, string> = APP) => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/read/5/out", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ item: "5" }) },
  );
};

test("the click is recorded with the link's kind, from android", async () => {
  current.mockResolvedValue(account);
  reader.mockResolvedValue(page);
  expect((await post({ moment: "9" })).status).toBe(204);
  expect(reader).toHaveBeenCalledWith("u1", "5", "9");
  expect(emit).toHaveBeenCalledWith(
    "outbound_click",
    { link_type: "anchor", target: "section" },
    expect.objectContaining({ source: "android", sessionId: null }),
  );
});

test("a guest, another site, a bad body or an unknown item: nothing recorded", async () => {
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await post({})).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await post({}, {})).status).toBe(403);
  expect((await post({ moment: "x" })).status).toBe(400);
  reader.mockResolvedValue(null);
  expect((await post({})).status).toBe(404);
  expect(emit).not.toHaveBeenCalled();
});
