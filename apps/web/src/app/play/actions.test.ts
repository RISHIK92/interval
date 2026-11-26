import { afterEach, expect, test, vi } from "vitest";
import type { Actor, GuestLimits, GuestSessions } from "../../server/ports";

// ADR-0029, ADR-0056: a guest for Play starts with no invite code, one per browser.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const start = vi.fn<GuestSessions["start"]>();
const emit = vi.fn();
const allow = vi.fn<GuestLimits["allow"]>(() => Promise.resolve(true));
const record = vi.fn<GuestLimits["record"]>(() => Promise.resolve());
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  guestSessions: () => ({ start }),
  guestLimits: () => ({ allow, record }),
  events: () => ({ emit }),
}));
const setCookie = vi.fn();
const getCookie = vi.fn<(name: string) => { value: string } | undefined>();
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(new Headers({ "x-forwarded-for": "203.0.113.5" })),
  cookies: () => Promise.resolve({ set: setCookie, get: getCookie }),
}));
const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect }));

afterEach(() => {
  vi.clearAllMocks();
});

async function startGuest() {
  const { startGuestAction } = await import("./actions");
  return startGuestAction();
}

test("a visitor with a session goes to Play without a second guest", async () => {
  current.mockResolvedValue({
    userId: "g1",
    isGuest: true,
    betaGroup: "student",
  });
  await expect(startGuest()).rejects.toThrow("redirect:/play");
  expect(start).not.toHaveBeenCalled();
});

test("with no code, a guest starts, with no group, starts a visit and lands on Play", async () => {
  current.mockResolvedValue(null);
  const guest = { userId: "g1", isGuest: true, betaGroup: null } as const;
  start.mockResolvedValue({ setCookies: [], actor: guest });
  await expect(startGuest()).rejects.toThrow("redirect:/play");
  expect(start).toHaveBeenCalledOnce();
  // Local tests have no proxy in front: every visitor is one network.
  expect(allow).toHaveBeenCalledWith("local");
  expect(record).toHaveBeenCalledWith("local");
  const [name, value] = setCookie.mock.calls[0] as [string, string];
  expect(name).toBe("iv_visit");
  // P3-W13-S07: this browser now has a player, for 30 days.
  expect(setCookie).toHaveBeenCalledWith(
    "iv_player",
    "1",
    expect.objectContaining({ httpOnly: true, maxAge: 30 * 86_400 }),
  );
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "session_started",
    {},
    { ...guest, sessionId: value.split(".")[0] },
  );
});

test("a browser that already had a player gets no new guest (P3-W13-S07)", async () => {
  current.mockResolvedValue(null);
  getCookie.mockImplementation((name) =>
    name === "iv_player" ? { value: "1" } : undefined,
  );
  expect(await startGuest()).toEqual({
    message: "This browser already had a player. Sign in instead.",
  });
  expect(allow).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  getCookie.mockReset();
});

test("a network over its daily limit gets no guest", async () => {
  current.mockResolvedValue(null);
  allow.mockResolvedValueOnce(false);
  expect(await startGuest()).toEqual({
    message:
      "Too many guests from this network today. Sign in, or try again tomorrow.",
  });
  expect(start).not.toHaveBeenCalled();
});
