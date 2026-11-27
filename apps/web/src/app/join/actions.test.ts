import { afterEach, expect, test, vi } from "vitest";
import { ACCOUNTS_PER_NETWORK_HOUR } from "../../server/accounts";
import type {
  Accounts,
  Actor,
  InviteCodes,
  RateLimits,
  Redemption,
} from "../../server/ports";

// Account first (ADR-0016, owner 2026-10-26): /join makes the account, then onboarding.
// ADR-0056: no invite code needed; a link's code still sets the group.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const redeem = vi.fn<(code: string) => Promise<Redemption>>();
const release = vi.fn(() => Promise.resolve());
const create = vi.fn<Accounts["create"]>();
const requestVerification = vi.fn<Accounts["requestVerification"]>(() =>
  Promise.resolve(),
);
// Q-P7-05: Next's `after`, held so a test sees the work happens after the response.
const afterResponse: (() => Promise<unknown>)[] = [];
vi.mock("next/server", () => ({
  after: (task: () => Promise<unknown>) => {
    afterResponse.push(task);
  },
}));
const codes: InviteCodes = { redeem, release };
const emit = vi.fn();
const allow = vi.fn<RateLimits["allow"]>(() => Promise.resolve(true));
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  inviteCodes: () => codes,
  accounts: () => ({ create, requestVerification }),
  rateLimits: () => ({ allow }),
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
  afterResponse.length = 0;
});

const FIELDS: Record<string, string> = {
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

test("with no code, the account is made with no group, a visit starts and onboarding follows", async () => {
  current.mockResolvedValue(null);
  const account = { userId: "u9", isGuest: false, betaGroup: null } as const;
  create.mockResolvedValue({ ok: true, setCookies: [], actor: account });
  await expect(join(form())).rejects.toThrow("redirect:/onboarding");
  expect(redeem).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledExactlyOnceWith(
    null,
    { name: "Ada", email: "ada@example.test", password: "correct horse" },
    expect.any(Headers),
  );
  // Local tests have no proxy in front: every visitor is one network.
  expect(allow).toHaveBeenCalledWith(
    "sign-up:local",
    ACCOUNTS_PER_NETWORK_HOUR,
    3600,
  );
  // The visit starts here, not in the proxy (app/visit.ts explains why).
  const [name, value] = setCookie.mock.calls[0] as [string, string];
  expect(name).toBe("iv_visit");
  const visitId = value.split(".")[0];
  expect(emit.mock.calls).toEqual([
    ["session_started", {}, { ...account, sessionId: visitId }],
    ["signup_completed", {}, { ...account, sessionId: visitId }],
  ]);
  // Q-P7-05 (owner, 2026-11-27): the verification mail waits for the response.
  expect(requestVerification).not.toHaveBeenCalled();
  expect(afterResponse).toHaveLength(1);
  await afterResponse[0]?.();
  expect(requestVerification).toHaveBeenCalledWith("ada@example.test");
  expect(emit).toHaveBeenLastCalledWith(
    "email_verification_sent",
    { trigger: "sign_up" },
    { ...account, sessionId: visitId },
  );
});

test("a code from an old invite link still sets the group", async () => {
  current.mockResolvedValue(null);
  const redemption = {
    ok: true,
    inviteCodeId: "4",
    betaGroup: "developer",
  } as const;
  redeem.mockResolvedValue(redemption);
  const account = {
    userId: "u9",
    isGuest: false,
    betaGroup: "developer",
  } as const;
  create.mockResolvedValue({ ok: true, setCookies: [], actor: account });
  await expect(join(form({ ...FIELDS, code: "ABCDE-FGHJK" }))).rejects.toThrow(
    "redirect:/onboarding",
  );
  expect(redeem).toHaveBeenCalledWith("ABCDE-FGHJK");
  expect(create.mock.calls[0]?.[0]).toEqual(redemption);
});

test("refused details or a busy network return a message and stay on the page", async () => {
  current.mockResolvedValue(null);
  expect(await join(form({ ...FIELDS, password: "short" }))).toEqual({
    message: "Use a password of 8 to 128 characters.",
  });
  allow.mockResolvedValueOnce(false);
  expect(await join(form())).toEqual({
    message: "Too many new accounts from this network. Try again in an hour.",
  });
  expect(create).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});

test("a file instead of a password is refused without touching the store", async () => {
  current.mockResolvedValue(null);
  const data = form();
  data.set("password", new Blob(["x"]));
  const result = await join(data);
  expect(result).not.toBeNull();
  expect(create).not.toHaveBeenCalled();
});
