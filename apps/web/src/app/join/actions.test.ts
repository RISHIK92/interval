import { afterEach, expect, test, vi } from "vitest";
import type {
  Accounts,
  Actor,
  InviteCodes,
  Redemption,
} from "../../server/ports";

// Account first (ADR-0016, owner 2026-10-26): /join makes the account with the invite
// code, then onboarding.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const redeem = vi.fn<(code: string) => Promise<Redemption>>();
const release = vi.fn(() => Promise.resolve());
const create = vi.fn<Accounts["create"]>();
const codes: InviteCodes = { redeem, release };
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  inviteCodes: () => codes,
  accounts: () => ({ create }),
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

const FIELDS = {
  code: "ABCDE-FGHJK",
  name: "Ada",
  email: "ada@example.test",
  password: "correct horse",
};

function form(fields: Record<string, string> = FIELDS): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function join(data: FormData) {
  const { join: action } = await import("./actions");
  return action(null, data);
}

test("a visitor who already has a session goes home without using a code", async () => {
  current.mockResolvedValue({
    userId: "u1",
    isGuest: false,
    betaGroup: "student",
  });
  await expect(join(form())).rejects.toThrow("redirect:/");
  expect(redeem).not.toHaveBeenCalled();
});

test("a valid code makes the account, starts a visit and goes to onboarding", async () => {
  current.mockResolvedValue(null);
  redeem.mockResolvedValue({
    ok: true,
    inviteCodeId: "4",
    betaGroup: "developer",
  });
  const account = {
    userId: "u9",
    isGuest: false,
    betaGroup: "developer",
  } as const;
  create.mockResolvedValue({ ok: true, setCookies: [], actor: account });
  await expect(join(form())).rejects.toThrow("redirect:/onboarding");
  expect(create).toHaveBeenCalledOnce();
  // The visit starts here, not in the proxy (app/visit.ts explains why).
  const [name, value] = setCookie.mock.calls[0] as [string, string];
  expect(name).toBe("iv_visit");
  const visitId = value.split(".")[0];
  expect(emit.mock.calls).toEqual([
    ["session_started", {}, { ...account, sessionId: visitId }],
    ["signup_completed", {}, { ...account, sessionId: visitId }],
  ]);
});

test("a refused code or detail returns its message and stays on the page", async () => {
  current.mockResolvedValue(null);
  redeem.mockResolvedValue({ ok: false, reason: "used_up" });
  expect(await join(form())).toEqual({
    message: "That invite code has no uses left.",
  });
  expect(await join(form({ ...FIELDS, password: "short" }))).toEqual({
    message: "Use a password of 8 to 128 characters.",
  });
  expect(emit).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});

test.each([
  ["a missing code", { ...FIELDS, code: undefined }],
  ["a file instead of a password", { ...FIELDS, password: new Blob(["x"]) }],
])("%s is refused without touching the store", async (_case, fields) => {
  current.mockResolvedValue(null);
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data.set(key, value);
  }
  const result = await join(data);
  expect(result).not.toBeNull();
  expect(create).not.toHaveBeenCalled();
});
