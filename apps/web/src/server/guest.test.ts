import { afterEach, describe, expect, test, vi } from "vitest";
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

function deps(
  redemption: Redemption,
  start?: () => Promise<{ setCookies: string[] }>,
) {
  const redeem = vi.fn<(code: string) => Promise<Redemption>>(() =>
    Promise.resolve(redemption),
  );
  const release = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
  const startFn = vi.fn<GuestSessions["start"]>(
    start ?? (() => Promise.resolve({ setCookies: ["session=abc"] })),
  );
  const codes: InviteCodes = { redeem, release };
  const guests: GuestSessions = { start: startFn };
  return { deps: { codes, guests }, redeem, release, start: startFn };
}

const headers = new Headers();
const valid: Redemption = { ok: true, inviteCodeId: "9", betaGroup: "student" };

describe("startGuest", () => {
  test("a valid code starts a guest session with that redemption", async () => {
    const d = deps(valid);
    expect(await startGuest(d.deps, "ABCDE-FGHJK", headers)).toEqual({
      ok: true,
      setCookies: ["session=abc"],
    });
    expect(d.start).toHaveBeenCalledWith(valid, headers);
  });

  test.each([
    ["unknown", "That invite code isn't valid."],
    ["expired", "That invite code isn't valid."],
    ["used_up", "That invite code has no uses left."],
  ] as const)(
    "a %s code returns a message and starts nothing",
    async (reason, message) => {
      const d = deps({ ok: false, reason });
      expect(await startGuest(d.deps, "ABCDE-FGHJK", headers)).toEqual({
        ok: false,
        message,
      });
      expect(d.start).not.toHaveBeenCalled();
    },
  );

  test("malformed input is refused without touching the store", async () => {
    const d = deps(valid);
    expect(await startGuest(d.deps, "<script>", headers)).toEqual({
      ok: false,
      message: "That invite code isn't valid.",
    });
    expect(d.redeem).not.toHaveBeenCalled();
  });

  test("if creating the guest fails, the use is released and the error rethrown", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const d = deps(valid, () => Promise.reject(new Error("db down")));
    await expect(startGuest(d.deps, "ABCDE-FGHJK", headers)).rejects.toThrow(
      "db down",
    );
    expect(d.release).toHaveBeenCalledWith("9");
  });

  test("if a half-made guest was left behind, the use stays spent", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const leftBehind = new GuestNotRemoved("guest left behind");
    const d = deps(valid, () => Promise.reject(leftBehind));
    await expect(startGuest(d.deps, "ABCDE-FGHJK", headers)).rejects.toBe(
      leftBehind,
    );
    expect(d.release).not.toHaveBeenCalled();
  });
});
