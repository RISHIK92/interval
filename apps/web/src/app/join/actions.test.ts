import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  GuestSessions,
  InviteCodes,
  Redemption,
} from "../../server/ports";

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

function form(code?: string | Blob): FormData {
  const data = new FormData();
  if (code !== undefined) data.set("code", code);
  return data;
}

async function join(data: FormData) {
  const { join: action } = await import("./actions");
  return action(null, data);
}

test("a visitor who already has a session goes home without using a code", async () => {
  current.mockResolvedValue({
    userId: "u1",
    isGuest: true,
    betaGroup: "student",
  });
  await expect(join(form("ABCDE-FGHJK"))).rejects.toThrow("redirect:/");
  expect(redeem).not.toHaveBeenCalled();
});

test("a valid code starts a guest and goes home", async () => {
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
  await expect(join(form("ABCDE-FGHJK"))).rejects.toThrow("redirect:/");
  expect(start).toHaveBeenCalledOnce();
  // The visit starts here, not in the proxy (app/visit.ts explains why).
  const [name, value] = setCookie.mock.calls[0] as [string, string];
  expect(name).toBe("iv_visit");
  const visitId = value.split(".")[0];
  expect(emit).toHaveBeenCalledExactlyOnceWith(
    "session_started",
    {},
    {
      ...guest,
      sessionId: visitId,
    },
  );
});

test("a refused code returns its message and stays on the page", async () => {
  current.mockResolvedValue(null);
  redeem.mockResolvedValue({ ok: false, reason: "used_up" });
  expect(await join(form("ABCDE-FGHJK"))).toEqual({
    message: "That invite code has no uses left.",
  });
  expect(redirect).not.toHaveBeenCalled();
});

test.each([
  ["missing", undefined],
  ["a file", new Blob(["ABCDE-FGHJK"])],
])(
  "a %s code field is refused without touching the store",
  async (_name, value) => {
    current.mockResolvedValue(null);
    expect(await join(form(value))).toEqual({
      message: "That invite code isn't valid.",
    });
    expect(redeem).not.toHaveBeenCalled();
  },
);
