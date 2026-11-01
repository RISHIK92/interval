import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  GuestLimits,
  GuestSessions,
  InviteCodes,
  Redemption,
} from "../../server/ports";

// ADR-0029, Q-P1-24: a guest for Play starts with an invite code, one per browser.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const redeem = vi.fn<(code: string) => Promise<Redemption>>();
const start = vi.fn<GuestSessions["start"]>();
const codes: InviteCodes = { redeem, release: () => Promise.resolve() };
const emit = vi.fn();
const allow = vi.fn<GuestLimits["allow"]>(() => Promise.resolve(true));
const record = vi.fn<GuestLimits["record"]>(() => Promise.resolve());
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  inviteCodes: () => codes,
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

function form(code?: string): FormData {
  const data = new FormData();
  if (code !== undefined) data.set("code", code);
  return data;
}

async function startGuest(data: FormData) {
  const { startGuestAction } = await import("./actions");
  return startGuestAction(null, data);
}

test("a visitor with a session goes to Play without a second guest or a code use", async () => {
  current.mockResolvedValue({
    userId: "g1",
    isGuest: true,
    betaGroup: "student",
  });
  await expect(startGuest(form("ABCDE-FGHJK"))).rejects.toThrow(
    "redirect:/play",
  );
  expect(redeem).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

test("a valid code starts a guest, starts a visit and lands on Play", async () => {
  current.mockResolvedValue(null);
  redeem.mockResolvedValue({
    ok: true,
    inviteCodeId: "4",
    betaGroup: "developer",
  });
  const guest = {
    userId: "g1",
    isGuest: true,
    betaGroup: "developer",
  } as const;
  start.mockResolvedValue({ setCookies: [], actor: guest });
  await expect(startGuest(form("ABCDE-FGHJK"))).rejects.toThrow(
    "redirect:/play",
  );
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

test("a refused code returns its message and stays on Play", async () => {
  current.mockResolvedValue(null);
  redeem.mockResolvedValue({ ok: false, reason: "used_up" });
  expect(await startGuest(form("ABCDE-FGHJK"))).toEqual({
    message: "That invite code has no uses left.",
  });
  expect(redirect).not.toHaveBeenCalled();
});

test("a missing code is refused without touching the store", async () => {
  current.mockResolvedValue(null);
  expect(await startGuest(form())).toEqual({
    message: "That invite code isn't valid.",
  });
  expect(redeem).not.toHaveBeenCalled();
});

test("a browser that already had a player gets no new guest (P3-W13-S07)", async () => {
  current.mockResolvedValue(null);
  getCookie.mockImplementation((name) =>
    name === "iv_player" ? { value: "1" } : undefined,
  );
  expect(await startGuest(form("ABCDE-FGHJK"))).toEqual({
    message: "This browser already had a player. Sign in instead.",
  });
  expect(allow).not.toHaveBeenCalled();
  expect(redeem).not.toHaveBeenCalled();
  getCookie.mockReset();
});

test("a network over its daily limit gets no guest", async () => {
  current.mockResolvedValue(null);
  allow.mockResolvedValueOnce(false);
  expect(await startGuest(form("ABCDE-FGHJK"))).toEqual({
    message:
      "Too many guests from this network today. Sign in, or try again tomorrow.",
  });
  expect(redeem).not.toHaveBeenCalled();
});
