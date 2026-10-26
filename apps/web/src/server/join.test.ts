import { afterEach, describe, expect, test, vi } from "vitest";
import { joinWithInvite } from "./accounts";
import {
  AccountNotRemoved,
  type Accounts,
  type InviteCodes,
  type Redemption,
} from "./ports";

// Account-first join (ADR-0016, owner 2026-10-26): the invite code and the account in
// one form, on fake ports (ADR-0012).
afterEach(() => {
  vi.restoreAllMocks();
});

const ACTOR = { userId: "u1", isGuest: false, betaGroup: "student" } as const;
const valid: Redemption = { ok: true, inviteCodeId: "9", betaGroup: "student" };
const headers = new Headers();
const form = {
  code: "ABCDE-FGHJK",
  name: "Ada",
  email: "Ada@Example.test",
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
  return {
    deps: {
      codes: { redeem, release } satisfies InviteCodes,
      accounts: { create: createFn },
    },
    redeem,
    release,
    create: createFn,
  };
}

describe("joinWithInvite", () => {
  test("a valid code and details make the account in the code's group", async () => {
    const d = deps();
    expect(await joinWithInvite(d.deps, form, headers)).toEqual({
      ok: true,
      setCookies: ["session=abc"],
      actor: ACTOR,
    });
    expect(d.redeem).toHaveBeenCalledWith("ABCDE-FGHJK");
    expect(d.create).toHaveBeenCalledWith(
      valid,
      { name: "Ada", email: "ada@example.test", password: "correct horse" },
      headers,
    );
    expect(d.release).not.toHaveBeenCalled();
  });

  test.each([
    [{ name: "" }, "Enter a name of up to 80 characters."],
    [{ email: "nope" }, "Enter a valid email address."],
    [{ password: "short" }, "Use a password of 8 to 128 characters."],
  ])("bad details (%j) never spend a code", async (change, message) => {
    const d = deps();
    expect(
      await joinWithInvite(d.deps, { ...form, ...change }, headers),
    ).toEqual({ ok: false, message });
    expect(d.redeem).not.toHaveBeenCalled();
  });

  test.each([
    ["unknown", "That invite code isn't valid."],
    ["expired", "That invite code isn't valid."],
    ["used_up", "That invite code has no uses left."],
  ] as const)("a %s code is refused", async (reason, message) => {
    const d = deps({ ok: false, reason });
    expect(await joinWithInvite(d.deps, form, headers)).toEqual({
      ok: false,
      message,
    });
    expect(d.create).not.toHaveBeenCalled();
  });

  test("an email already in use gives the use back and says sign in", async () => {
    const d = deps(valid, () =>
      Promise.resolve({ ok: false, reason: "email_taken" }),
    );
    expect(await joinWithInvite(d.deps, form, headers)).toEqual({
      ok: false,
      message: "An account with that email already exists. Sign in instead.",
    });
    expect(d.release).toHaveBeenCalledExactlyOnceWith("9");
  });

  test("a failure while creating gives the use back and is not hidden", async () => {
    const d = deps(valid, () => Promise.reject(new Error("db down")));
    await expect(joinWithInvite(d.deps, form, headers)).rejects.toThrow(
      "db down",
    );
    expect(d.release).toHaveBeenCalledExactlyOnceWith("9");
  });

  test("a half-made account that stayed keeps its use spent", async () => {
    const d = deps(valid, () => Promise.reject(new AccountNotRemoved("kept")));
    await expect(joinWithInvite(d.deps, form, headers)).rejects.toThrow("kept");
    expect(d.release).not.toHaveBeenCalled();
  });

  test("a use that can't be given back doesn't hide the cause", async () => {
    const d = deps(valid, () => Promise.reject(new Error("db down")));
    d.release.mockRejectedValueOnce(new Error("release failed"));
    await expect(joinWithInvite(d.deps, form, headers)).rejects.toThrow(
      "db down",
    );
  });
});
