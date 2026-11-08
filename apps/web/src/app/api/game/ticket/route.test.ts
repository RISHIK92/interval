import { createHmac } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Actor, Matches } from "../../../../server/ports";

// P3-W15-S02 (ADR-0033): a short-lived, single-use ticket for a match the player is in.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const serverFor = vi.fn<Matches["serverFor"]>((_, userId) =>
  Promise.resolve({ serverId: 0, playedAs: userId }),
);
const SECRET = "0123456789abcdef0123456789abcdef";
let secret: string | null = SECRET;
// ADR-0036: the route checks its capability; granted unless a test says not.
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
vi.mock("../../../../server/container", () => ({
  entitlements: () => ({ can }),
  sessionReader: () => ({ current }),
  matches: () => ({ serverFor }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
  gameEnv: () => (secret === null ? null : { GAME_TICKET_SECRET: secret }),
}));

const MATCH = "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b";
const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  secret = SECRET;
});

async function post(
  body: unknown,
  origin = "http://localhost:3100",
): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost:3100/api/game/ticket", {
      method: "POST",
      headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("a player of the match gets a socket URL with a signed, one-minute ticket", async () => {
  current.mockResolvedValue(account);
  serverFor.mockResolvedValueOnce({ serverId: 3, playedAs: "u1" });
  const response = await post({ matchId: MATCH });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(serverFor).toHaveBeenCalledExactlyOnceWith(MATCH, "u1");
  const { url } = (await response.json()) as { url: string };
  const match = /^\/game\/3\/ws\?ticket=(.+)$/.exec(url);
  const ticket = decodeURIComponent(match?.[1] ?? "");
  const [version, payload, signature] = ticket.split(".");
  expect(version).toBe("v1");
  expect(
    createHmac("sha256", SECRET)
      .update(`v1.${payload ?? ""}`)
      .digest("base64url"),
  ).toBe(signature);
  const claims = JSON.parse(
    Buffer.from(payload ?? "", "base64url").toString(),
  ) as Record<string, unknown>;
  expect(claims).toMatchObject({
    m: MATCH,
    u: "u1",
    s: "3",
    e: Date.UTC(2026, 10, 2, 12, 1) / 1000,
  });
  expect(claims["n"]).toMatch(/^[0-9a-f-]{36}$/);
  // A fresh nonce each time: two tickets are never the same.
  const again = (await (await post({ matchId: MATCH })).json()) as {
    url: string;
  };
  expect(again.url).not.toBe(url);
});

// Q-P3-21: a guest who signed up mid-match comes back as the player the match knows.
test("the ticket names the player as the match knows them", async () => {
  current.mockResolvedValue(account);
  serverFor.mockResolvedValueOnce({ serverId: 0, playedAs: "guest-7" });
  const { url } = (await (await post({ matchId: MATCH })).json()) as {
    url: string;
  };
  const payload = decodeURIComponent(url.split("ticket=")[1] ?? "").split(
    ".",
  )[1];
  expect(
    JSON.parse(Buffer.from(payload ?? "", "base64url").toString()),
  ).toMatchObject({ u: "guest-7" });
});

test("a guest plays live too", async () => {
  current.mockResolvedValue(guest);
  expect((await post({ matchId: MATCH })).status).toBe(200);
  expect(serverFor).toHaveBeenCalledWith(MATCH, "g1");
});

test("not a player of it, or no such match: 404", async () => {
  current.mockResolvedValue(account);
  serverFor.mockResolvedValueOnce(null);
  expect((await post({ matchId: MATCH })).status).toBe(404);
});

test("signed out, another site, or a bad body: refused before any lookup", async () => {
  current.mockResolvedValue(null);
  expect((await post({ matchId: MATCH })).status).toBe(401);
  current.mockResolvedValue(account);
  expect((await post({ matchId: MATCH }, "https://evil.example")).status).toBe(
    403,
  );
  for (const body of [{}, { matchId: "7" }, { matchId: 7 }, null])
    expect((await post(body)).status).toBe(400);
  expect(serverFor).not.toHaveBeenCalled();
});

test("without a ticket secret, live games aren't offered", async () => {
  secret = null;
  current.mockResolvedValue(account);
  expect((await post({ matchId: MATCH })).status).toBe(503);
  expect(serverFor).not.toHaveBeenCalled();
});

test("without play.live, no ticket: 403", async () => {
  current.mockResolvedValue(account);
  can.mockResolvedValueOnce(false);
  expect((await post({ matchId: MATCH })).status).toBe(403);
  expect(serverFor).not.toHaveBeenCalled();
});
