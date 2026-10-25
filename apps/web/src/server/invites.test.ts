import { describe, expect, test, vi } from "vitest";
import { redeemInvite } from "./invites";
import type { InviteCodes, Redemption } from "./ports";

// Invite logic on a fake port (ADR-0012); the database cases are in
// adapters/kysely-invites.test.ts.
function fake(result: Redemption) {
  const redeem = vi.fn<(code: string) => Promise<Redemption>>(() =>
    Promise.resolve(result),
  );
  const codes: InviteCodes = { redeem, release: () => Promise.resolve() };
  return { codes, redeem };
}

describe("redeemInvite", () => {
  test("a valid code returns its beta group", async () => {
    const { codes, redeem } = fake({
      ok: true,
      inviteCodeId: "7",
      betaGroup: "student",
    });
    expect(await redeemInvite(codes, "ABCDE-FGHJK")).toEqual({
      ok: true,
      inviteCodeId: "7",
      betaGroup: "student",
    });
    expect(redeem).toHaveBeenCalledWith("ABCDE-FGHJK");
  });

  test.each(["unknown", "expired", "used_up"] as const)(
    "passes through %s",
    async (reason) => {
      const { codes } = fake({ ok: false, reason });
      expect(await redeemInvite(codes, "ABCDE-FGHJK")).toEqual({
        ok: false,
        reason,
      });
    },
  );

  test.each(["", "   ", "abc", "X".repeat(200), "<script>"])(
    "rejects malformed input %j without touching the store",
    async (raw) => {
      const { codes, redeem } = fake({
        ok: true,
        inviteCodeId: "1",
        betaGroup: "developer",
      });
      expect(await redeemInvite(codes, raw)).toEqual({
        ok: false,
        reason: "unknown",
      });
      expect(redeem).not.toHaveBeenCalled();
    },
  );
});
