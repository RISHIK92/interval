import { afterEach, describe, expect, test, vi } from "vitest";
import { memoryRateLimits } from "./adapters/valkey-rate-limits";
import {
  requestReset,
  mailVerificationOnSignUp,
  requestVerification,
  resetPassword,
  signIn,
  signUp,
  VERIFY_LINKS_PER_HOUR,
  VERIFY_MAIL_TRIES,
} from "./accounts";
import type { Accounts, SignUpResult } from "./ports";

// Account logic on a fake port (ADR-0012); Better Auth itself is tested in
// adapters/better-auth-accounts.test.ts.

afterEach(() => {
  vi.restoreAllMocks();
});

const ACCOUNT = {
  userId: "a1",
  isGuest: false,
  betaGroup: "student",
} as const;

function fake(
  opts: { signUp?: SignUpResult; signIn?: boolean; reset?: boolean } = {},
) {
  const port = {
    signUp: vi.fn<Accounts["signUp"]>(() =>
      Promise.resolve(opts.signUp ?? { ok: true, setCookies: [] }),
    ),
    signIn: vi.fn<Accounts["signIn"]>(() =>
      Promise.resolve(
        opts.signIn === false
          ? null
          : { setCookies: [], actor: ACCOUNT, mergedGuest: false },
      ),
    ),
    create: vi.fn<Accounts["create"]>(),
    signOut: vi.fn<Accounts["signOut"]>(() => Promise.resolve()),
    requestReset: vi.fn<Accounts["requestReset"]>(() => Promise.resolve()),
    resetPassword: vi.fn<Accounts["resetPassword"]>(() =>
      Promise.resolve(opts.reset ?? true),
    ),
    setPassword: vi.fn<Accounts["setPassword"]>(() => Promise.resolve(true)),
    requestVerification: vi.fn<Accounts["requestVerification"]>(() =>
      Promise.resolve(),
    ),
    emailStatus: vi.fn<Accounts["emailStatus"]>(() =>
      Promise.resolve({ email: "ada@example.test", verified: false }),
    ),
  };
  return port satisfies Accounts;
}

const headers = new Headers();
const PASSWORD = "correct horse battery";
const valid = {
  name: "  Ada  ",
  email: "  Ada@Example.TEST ",
  password: PASSWORD,
};

describe("signUp", () => {
  test("passes trimmed, lower-cased input to the port", async () => {
    const port = fake();
    expect(await signUp(port, headers, valid)).toEqual({
      ok: true,
      email: "ada@example.test",
    });
    expect(port.signUp).toHaveBeenCalledWith(headers, {
      name: "Ada",
      email: "ada@example.test",
      password: PASSWORD,
    });
  });

  test.each([
    ["a bad email", { email: "not-an-email" }, "Enter a valid email address."],
    [
      "a 7-character password",
      { password: "1234567" },
      "Use a password of 8 to 128 characters.",
    ],
    [
      "a 129-character password",
      { password: "x".repeat(129) },
      "Use a password of 8 to 128 characters.",
    ],
    ["an empty name", { name: "   " }, "Enter a name of up to 80 characters."],
    [
      "an 81-character name",
      { name: "n".repeat(81) },
      "Enter a name of up to 80 characters.",
    ],
  ])("refuses %s without touching the port", async (_case, change, message) => {
    const port = fake();
    expect(await signUp(port, headers, { ...valid, ...change })).toEqual({
      ok: false,
      message,
    });
    expect(port.signUp).not.toHaveBeenCalled();
  });

  test("a password of exactly 8 or 128 characters is accepted", async () => {
    for (const password of ["12345678", "x".repeat(128)]) {
      expect((await signUp(fake(), headers, { ...valid, password })).ok).toBe(
        true,
      );
    }
  });

  test.each([
    [
      "email_taken",
      "An account with that email already exists. Sign in instead.",
    ],
    ["not_a_guest", "Your guest session ended. Create your account from Join."],
  ] as const)("maps %s to its message", async (reason, message) => {
    const port = fake({ signUp: { ok: false, reason } });
    expect(await signUp(port, headers, valid)).toEqual({ ok: false, message });
  });
});

describe("signIn", () => {
  test("passes the normalised email and the password as typed", async () => {
    const port = fake();
    expect(
      await signIn(port, headers, {
        email: " Ada@Example.TEST",
        password: PASSWORD,
      }),
    ).toEqual({
      ok: true,
      actor: ACCOUNT,
      mergedGuest: false,
    });
    expect(port.signIn).toHaveBeenCalledWith(
      headers,
      "ada@example.test",
      PASSWORD,
    );
  });

  test("a wrong password and malformed input get the same message", async () => {
    const message = "Email or password is incorrect.";
    expect(
      await signIn(fake({ signIn: false }), headers, {
        email: "a@b.test",
        password: PASSWORD,
      }),
    ).toEqual({
      ok: false,
      message,
    });
    const port = fake();
    for (const input of [
      { email: "nope", password: PASSWORD },
      { email: "a@b.test", password: "x".repeat(129) },
    ]) {
      expect(await signIn(port, headers, input)).toEqual({
        ok: false,
        message,
      });
    }
    expect(port.signIn).not.toHaveBeenCalled();
  });
});

// Q-P7-05 (owner, 2026-11-27): a link on sign-up, and Profile's button for the rest.
describe("email verification", () => {
  test("sign-up itself sends nothing: it hands back the normalised email", async () => {
    const port = fake();
    expect(await signUp(port, headers, valid)).toEqual({
      ok: true,
      email: "ada@example.test",
    });
    expect(port.requestVerification).not.toHaveBeenCalled();
  });

  test("after sign-up the link is mailed and recorded; a failure is tried again", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const port = fake();
    const events = { emit: vi.fn() };
    const wait = vi.fn(() => Promise.resolve());
    const context = { ...ACCOUNT, sessionId: "v1" };
    port.requestVerification.mockRejectedValueOnce(new Error("mail down"));
    expect(
      await mailVerificationOnSignUp(
        { accounts: port, events, wait },
        "ada@example.test",
        context,
      ),
    ).toBe(true);
    expect(port.requestVerification).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(events.emit).toHaveBeenCalledExactlyOnceWith(
      "email_verification_sent",
      { trigger: "sign_up" },
      context,
    );
  });

  test("after the last try the failure is logged for its metric, never thrown", async () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const port = fake();
    port.requestVerification.mockRejectedValue(new Error("mail down"));
    const events = { emit: vi.fn() };
    expect(
      await mailVerificationOnSignUp(
        { accounts: port, events, wait: () => Promise.resolve() },
        "ada@example.test",
        { ...ACCOUNT, sessionId: "v1" },
      ),
    ).toBe(false);
    expect(port.requestVerification).toHaveBeenCalledTimes(VERIFY_MAIL_TRIES);
    expect(events.emit).not.toHaveBeenCalled();
    expect(written.join("")).toContain(
      '"msg":"account: verification mail failed"',
    );
  });

  test("a refused sign-up mails nothing", async () => {
    const port = fake({ signUp: { ok: false, reason: "email_taken" } });
    await signUp(port, headers, valid);
    expect(port.requestVerification).not.toHaveBeenCalled();
  });

  test("Profile's button sends a link, at most VERIFY_LINKS_PER_HOUR an hour", async () => {
    const port = fake();
    const deps = { accounts: port, limits: memoryRateLimits() };
    for (let n = 0; n < VERIFY_LINKS_PER_HOUR; n += 1)
      expect(await requestVerification(deps, "a1")).toBe("sent");
    expect(await requestVerification(deps, "a1")).toBe("too_many");
    expect(port.requestVerification).toHaveBeenCalledTimes(
      VERIFY_LINKS_PER_HOUR,
    );
    expect(port.requestVerification).toHaveBeenCalledWith("ada@example.test");
  });

  test("a verified or missing account sends nothing; a failed mail is said", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const port = fake();
    const deps = { accounts: port, limits: memoryRateLimits() };
    port.emailStatus.mockResolvedValueOnce({
      email: "ada@example.test",
      verified: true,
    });
    expect(await requestVerification(deps, "a1")).toBe("verified");
    port.emailStatus.mockResolvedValueOnce(null);
    expect(await requestVerification(deps, "a1")).toBe("no_account");
    expect(port.requestVerification).not.toHaveBeenCalled();
    port.requestVerification.mockRejectedValueOnce(new Error("mail down"));
    expect(await requestVerification(deps, "a1")).toBe("failed");
  });
});

describe("password reset", () => {
  test("a request for a valid email reaches the port; a malformed one is dropped quietly", async () => {
    const port = fake();
    await requestReset(port, " Ada@Example.TEST ");
    await requestReset(port, "nope");
    expect(port.requestReset).toHaveBeenCalledExactlyOnceWith(
      "ada@example.test",
    );
  });

  test("a new password is checked for length before the port", async () => {
    const port = fake();
    expect(await resetPassword(port, "tok", "short")).toEqual({
      ok: false,
      message: "Use a password of 8 to 128 characters.",
    });
    expect(port.resetPassword).not.toHaveBeenCalled();
    expect(await resetPassword(port, "tok", PASSWORD)).toEqual({ ok: true });
    expect(port.resetPassword).toHaveBeenCalledWith("tok", PASSWORD);
  });

  test("a refused token gets one message", async () => {
    expect(
      await resetPassword(fake({ reset: false }), "tok", PASSWORD),
    ).toEqual({
      ok: false,
      message: "That reset link is invalid or has expired.",
    });
  });
});

test("passwords never reach the log, even when the port fails", async () => {
  const written: string[] = [];
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
  }
  const failing: Accounts = {
    ...fake(),
    signUp: () => Promise.reject(new Error("db down")),
    signIn: () => Promise.reject(new Error("db down")),
    resetPassword: () => Promise.reject(new Error("db down")),
  };
  await expect(signUp(failing, headers, valid)).rejects.toThrow("db down");
  await expect(
    signIn(failing, headers, { email: "a@b.test", password: PASSWORD }),
  ).rejects.toThrow("db down");
  await expect(resetPassword(failing, "tok", PASSWORD)).rejects.toThrow(
    "db down",
  );
  expect(written.join("")).not.toContain(PASSWORD);
});
