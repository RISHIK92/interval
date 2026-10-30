import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
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
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  inviteCodes: () => codes,
  guestSessions: () => ({ start }),
  events: () => ({ emit }),
}));
const setCookie = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ set: setCookie }),
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
  const [name, value] = setCookie.mock.calls[0] as [string, string];
  expect(name).toBe("iv_visit");
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
