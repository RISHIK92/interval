import { afterEach, describe, expect, test, vi } from "vitest";
import { memoryGuestLimits } from "./adapters/kysely-guest-limits";
import { startGuest } from "./guest";
import type { GuestSessions } from "./ports";

// Guest start logic on fake ports (ADR-0012); Better Auth itself is tested in
// adapters/better-auth.test.ts.

afterEach(() => {
  vi.restoreAllMocks();
});

// ADR-0056: a guest has no invite code and no beta group.
const GUEST = { userId: "g1", isGuest: true, betaGroup: null } as const;

function deps(start?: GuestSessions["start"]) {
  const startFn = vi.fn<GuestSessions["start"]>(
    start ??
      (() => Promise.resolve({ setCookies: ["session=abc"], actor: GUEST })),
  );
  const limits = memoryGuestLimits();
  const allow = vi.spyOn(limits, "allow");
  const record = vi.spyOn(limits, "record");
  return {
    deps: { guests: { start: startFn }, limits },
    start: startFn,
    allow,
    record,
  };
}

const headers = new Headers();
const IP = "203.0.113.5";

describe("startGuest", () => {
  test("a guest starts with no code and counts toward its network's day", async () => {
    const d = deps();
    expect(await startGuest(d.deps, headers, IP)).toEqual({
      ok: true,
      setCookies: ["session=abc"],
      actor: GUEST,
    });
    expect(d.start).toHaveBeenCalledExactlyOnceWith(headers);
    expect(d.record).toHaveBeenCalledExactlyOnceWith(IP);
  });

  test("a network over its daily limit is refused before a guest is made", async () => {
    const d = deps();
    for (let n = 0; n < 10; n += 1) await d.deps.limits.record(IP);
    expect(await startGuest(d.deps, headers, IP)).toEqual({
      ok: false,
      message:
        "Too many guests from this network today. Sign in, or try again tomorrow.",
    });
    expect(d.allow).toHaveBeenCalledWith(IP);
    expect(d.start).not.toHaveBeenCalled();
  });

  // Without a code, the network limit is the only throttle: ten from one network, then
  // no more that day, while another network is unaffected.
  test("ten guests a day from one network, then none", async () => {
    const d = deps();
    for (let n = 0; n < 10; n += 1)
      expect((await startGuest(d.deps, headers, IP)).ok).toBe(true);
    expect((await startGuest(d.deps, headers, IP)).ok).toBe(false);
    expect((await startGuest(d.deps, headers, "198.51.100.7")).ok).toBe(true);
    expect(d.start).toHaveBeenCalledTimes(11);
  });

  test("a failed start costs the network nothing and is not hidden", async () => {
    const d = deps(() => Promise.reject(new Error("db down")));
    await expect(startGuest(d.deps, headers, IP)).rejects.toThrow("db down");
    expect(d.record).not.toHaveBeenCalled();
  });

  test("a start that can't be counted still gives the guest", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const d = deps();
    d.record.mockRejectedValueOnce(new Error("db down"));
    expect((await startGuest(d.deps, headers, IP)).ok).toBe(true);
  });
});
