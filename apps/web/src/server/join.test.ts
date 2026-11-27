import { afterEach, describe, expect, test, vi } from "vitest";
import { memoryRateLimits } from "./adapters/valkey-rate-limits";
import { ACCOUNTS_PER_NETWORK_HOUR, createAccount } from "./accounts";
import {
  AccountNotRemoved,
  type Accounts,
  type InviteCodes,
  type Redemption,
} from "./ports";

// Account-first join (ADR-0016, owner 2026-10-26), open to anyone with no invite code
// (ADR-0056), on fake ports (ADR-0012).
afterEach(() => {
  vi.restoreAllMocks();
});

const ACTOR = { userId: "u1", isGuest: false, betaGroup: null } as const;
const valid: Redemption = { ok: true, inviteCodeId: "9", betaGroup: "student" };
const headers = new Headers();
const IP = "203.0.113.5";
const details = {
  name: "Ada",
  email: "Ada@Example.test",
  password: "correct horse",
};
const form = { code: "", ...details };
const withCode = { ...form, code: "ABCDE-FGHJK" };
const made = {
  name: "Ada",
  email: "ada@example.test",
  password: "correct horse",
};

function deps(redemption: Redemption = valid, create?: Accounts["create"]) {
  const redeem = vi.fn<InviteCodes["redeem"]>(() =>
    Promise.resolve(redemption),
  );
  const release = vi.fn<InviteCodes["release"]>(() => Promise.resolve());
  const createFn = vi.fn<Accounts["create"]>(
    create ??
      (() =>
        Promise.resolve({
          ok: true,
          setCookies: ["session=abc"],
          actor: ACTOR,
        })),
  );
  const limits = memoryRateLimits();
  return {
    deps: {
      codes: { redeem, release } satisfies InviteCodes,
      accounts: { create: createFn },
      limits,
    },
    redeem,
    release,
    create: createFn,
    limits,
  };
}

describe("createAccount", () => {
  test("no code makes the account with no group and touches no code", async () => {
    const d = deps();
    expect(await createAccount(d.deps, form, headers, IP)).toEqual({
      ok: true,
      setCookies: ["session=abc"],
      actor: ACTOR,
      email: "ada@example.test",
    });
    expect(d.redeem).not.toHaveBeenCalled();
    expect(d.create).toHaveBeenCalledWith(null, made, headers);
  });

  test("a blank code is the same as none", async () => {
    const d = deps();
    await createAccount(d.deps, { ...form, code: "   " }, headers, IP);
    expect(d.redeem).not.toHaveBeenCalled();
    expect(d.create).toHaveBeenCalledWith(null, made, headers);
  });

  // ADR-0056: a link sent during the private beta still sets its group.
  test("a valid code from a link makes the account in the code's group", async () => {
    const d = deps();
    await createAccount(d.deps, withCode, headers, IP);
    expect(d.redeem).toHaveBeenCalledWith("ABCDE-FGHJK");
    expect(d.create).toHaveBeenCalledWith(valid, made, headers);
    expect(d.release).not.toHaveBeenCalled();
  });

  test.each(["unknown", "expired", "used_up"] as const)(
    "a %s code no longer refuses: the account is made with no group",
    async (reason) => {
      const out = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const d = deps({ ok: false, reason });
      expect((await createAccount(d.deps, withCode, headers, IP)).ok).toBe(
        true,
      );
      expect(d.create).toHaveBeenCalledWith(null, made, headers);
      // The log says why the account has no group (ADR-0056).
      const lines = out.mock.calls.map(([line]) => String(line));
      expect(
        lines.some(
          (line) =>
            line.includes("join: invite code not used") &&
            line.includes(`"reason":"${reason}"`),
        ),
      ).toBe(true);
    },
  );

  test.each([
    [{ name: "" }, "Enter a name of up to 80 characters."],
    [{ email: "nope" }, "Enter a valid email address."],
    [{ password: "short" }, "Use a password of 8 to 128 characters."],
  ])(
    "bad details (%j) never spend a code or the network's limit",
    async (change, message) => {
      const d = deps();
      const allow = vi.spyOn(d.limits, "allow");
      expect(
        await createAccount(d.deps, { ...withCode, ...change }, headers, IP),
      ).toEqual({ ok: false, message });
      expect(d.redeem).not.toHaveBeenCalled();
      expect(allow).not.toHaveBeenCalled();
    },
  );

  // The invite code was the only throttle on new accounts; now the network is.
  test("a network past its hourly sign-ups is refused before a code is spent", async () => {
    const d = deps();
    for (let n = 0; n < ACCOUNTS_PER_NETWORK_HOUR; n += 1)
      expect((await createAccount(d.deps, form, headers, IP)).ok).toBe(true);
    expect(await createAccount(d.deps, withCode, headers, IP)).toEqual({
      ok: false,
      message: "Too many new accounts from this network. Try again in an hour.",
    });
    expect(d.redeem).not.toHaveBeenCalled();
    expect(d.create).toHaveBeenCalledTimes(ACCOUNTS_PER_NETWORK_HOUR);
    expect(
      (await createAccount(d.deps, form, headers, "198.51.100.7")).ok,
    ).toBe(true);
  });

  test("a limit that can't be read refuses the sign-up, never runs unthrottled", async () => {
    const d = deps();
    vi.spyOn(d.limits, "allow").mockRejectedValueOnce(new Error("valkey down"));
    await expect(createAccount(d.deps, withCode, headers, IP)).rejects.toThrow(
      "valkey down",
    );
    expect(d.redeem).not.toHaveBeenCalled();
    expect(d.create).not.toHaveBeenCalled();
  });

  test("an email already in use gives a code's use back and says sign in", async () => {
    const d = deps(valid, () =>
      Promise.resolve({ ok: false, reason: "email_taken" }),
    );
    expect(await createAccount(d.deps, withCode, headers, IP)).toEqual({
      ok: false,
      message: "An account with that email already exists. Sign in instead.",
    });
    expect(d.release).toHaveBeenCalledExactlyOnceWith("9");
    expect((await createAccount(d.deps, form, headers, IP)).ok).toBe(false);
    expect(d.release).toHaveBeenCalledOnce();
  });

  test("a failure while creating gives a code's use back and is not hidden", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const d = deps(valid, () => Promise.reject(new Error("db down")));
    await expect(createAccount(d.deps, withCode, headers, IP)).rejects.toThrow(
      "db down",
    );
    expect(d.release).toHaveBeenCalledExactlyOnceWith("9");
    await expect(createAccount(d.deps, form, headers, IP)).rejects.toThrow(
      "db down",
    );
    expect(d.release).toHaveBeenCalledOnce();
  });

  test("a half-made account that stayed keeps its use spent", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const d = deps(valid, () => Promise.reject(new AccountNotRemoved("kept")));
    await expect(createAccount(d.deps, withCode, headers, IP)).rejects.toThrow(
      "kept",
    );
    expect(d.release).not.toHaveBeenCalled();
  });

  test("a use that can't be given back doesn't hide the cause", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const d = deps(valid, () => Promise.reject(new Error("db down")));
    d.release.mockRejectedValueOnce(new Error("release failed"));
    await expect(createAccount(d.deps, withCode, headers, IP)).rejects.toThrow(
      "db down",
    );
  });
});
