import { afterEach, describe, expect, test, vi } from "vitest";
import { memoryGuestLimits } from "./adapters/kysely-guest-limits";
import { startGuest } from "./guest";
import {
  GuestNotRemoved,
  type GuestSessions,
  type InviteCodes,
  type Redemption,
} from "./ports";

// Guest start logic on fake ports (ADR-0012); Better Auth itself is tested in
// adapters/better-auth.test.ts.

afterEach(() => {
  vi.restoreAllMocks();
});

const GUEST = { userId: "g1", isGuest: true, betaGroup: "student" } as const;

function deps(redemption: Redemption, start?: GuestSessions["start"]) {
  const redeem = vi.fn<(code: string) => Promise<Redemption>>(() =>
    Promise.resolve(redemption),
  );
  const release = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
  const startFn = vi.fn<GuestSessions["start"]>(
    start ??
      (() => Promise.resolve({ setCookies: ["session=abc"], actor: GUEST })),
  );
  const codes: InviteCodes = { redeem, release };
  const guests: GuestSessions = { start: startFn };
  const limits = memoryGuestLimits();
  const allow = vi.spyOn(limits, "allow");
  const record = vi.spyOn(limits, "record");
  return {
    deps: { codes, guests, limits },
    redeem,
    release,
    start: startFn,
    allow,
    record,
  };
}

const headers = new Headers();
const IP = "203.0.113.5";
const valid: Redemption = { ok: true, inviteCodeId: "9", betaGroup: "student" };

describe("startGuest", () => {
  test("a refused code or a failed start costs the network nothing", async () => {
    const refused = deps({ ok: false, reason: "unknown" });
    for (let n = 0; n < 12; n += 1)
      await startGuest(refused.deps, "ABCDE-FGHJK", headers, IP);
    expect(refused.record).not.toHaveBeenCalled();
    const failing = deps(valid, () => Promise.reject(new Error("db down")));
    await expect(
      startGuest(failing.deps, "ABCDE-FGHJK", headers, IP),
    ).rejects.toThrow("db down");
    expect(failing.record).not.toHaveBeenCalled();
  });

  test("a network over its daily limit is refused before a code use is spent", async () => {
    const d = deps(valid);
    for (let n = 0; n < 10; n += 1) await d.deps.limits.record(IP);
    expect(await startGuest(d.deps, "ABCDE-FGHJK", headers, IP)).toEqual({
      ok: false,
      message:
        "Too many guests from this network today. Sign in, or try again tomorrow.",
    });
    expect(d.allow).toHaveBeenCalledWith(IP);
    expect(d.redeem).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
  });

  test("a valid code starts a guest session with that redemption", async () => {
    const d = deps(valid);
    expect(await startGuest(d.deps, "ABCDE-FGHJK", headers, IP)).toEqual({
      ok: true,
      setCookies: ["session=abc"],
      actor: GUEST,
    });
    expect(d.start).toHaveBeenCalledWith(valid, headers);
    // A guest that started counts toward the network's day (P3-W13-S07).
    expect(d.record).toHaveBeenCalledExactlyOnceWith(IP);
  });

  test.each([
    ["unknown", "That invite code isn't valid."],
    ["expired", "That invite code isn't valid."],
    ["used_up", "That invite code has no uses left."],
  ] as const)(
    "a %s code returns a message and starts nothing",
    async (reason, message) => {
      const d = deps({ ok: false, reason });
      expect(await startGuest(d.deps, "ABCDE-FGHJK", headers, IP)).toEqual({
        ok: false,
        message,
      });
      expect(d.start).not.toHaveBeenCalled();
    },
  );

  test("malformed input is refused without touching the store", async () => {
    const d = deps(valid);
    expect(await startGuest(d.deps, "<script>", headers, IP)).toEqual({
      ok: false,
      message: "That invite code isn't valid.",
    });
    expect(d.redeem).not.toHaveBeenCalled();
  });

  test("if creating the guest fails, the use is released and the error rethrown", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const d = deps(valid, () => Promise.reject(new Error("db down")));
    await expect(
      startGuest(d.deps, "ABCDE-FGHJK", headers, IP),
    ).rejects.toThrow("db down");
    expect(d.release).toHaveBeenCalledWith("9");
  });

  test("if a half-made guest was left behind, the use stays spent", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const leftBehind = new GuestNotRemoved("guest left behind");
    const d = deps(valid, () => Promise.reject(leftBehind));
    await expect(startGuest(d.deps, "ABCDE-FGHJK", headers, IP)).rejects.toBe(
      leftBehind,
    );
    expect(d.release).not.toHaveBeenCalled();
  });
});
