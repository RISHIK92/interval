import { afterEach, expect, test, vi } from "vitest";
import type { Actor, OutboundLink } from "../../../../../server/ports";

// P4-W20-S02 (§8): the app reader's Open in browser records the click, as /out does.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const resolve = vi.fn<() => Promise<OutboundLink | null>>();
const emit = vi.fn();
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  outboundLinks: () => ({ resolve }),
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
const link: OutboundLink = {
  url: "https://blog.dev/raft",
  linkType: "article",
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

// ADR-0058: always the article's page; a section an older app sends is ignored.
test("the click is recorded as the article's, from android", async () => {
  current.mockResolvedValue(account);
  resolve.mockResolvedValue(link);
  expect((await post({ moment: "9" })).status).toBe(204);
  expect(resolve).toHaveBeenCalledWith("5");
  expect(emit).toHaveBeenCalledWith(
    "outbound_click",
    { target: "article" },
    expect.objectContaining({ source: "android", sessionId: null }),
  );
});

test("a guest, another site, a bad body or an unknown item: nothing recorded", async () => {
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await post({})).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await post({}, {})).status).toBe(403);
  expect((await post("nope")).status).toBe(400);
  resolve.mockResolvedValue(null);
  expect((await post({})).status).toBe(404);
  expect(emit).not.toHaveBeenCalled();
});
