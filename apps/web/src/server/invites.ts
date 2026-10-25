import { z } from "zod";
import type { InviteCodes, Redemption } from "./ports";

// Codes are 10 characters, shown as XXXXX-XXXXX; anything far outside that is rejected
// at the boundary without touching the store.
const codeInput = z
  .string()
  .trim()
  .min(4)
  .max(64)
  // ASCII space and dash only, matching what normalize_invite_code() strips in SQL.
  .regex(/^[A-Za-z0-9 -]+$/);

// The single entry point for redeeming an invite code (guest start, sign-up).
export async function redeemInvite(
  codes: InviteCodes,
  raw: string,
): Promise<Redemption> {
  const parsed = codeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "unknown" };
  return codes.redeem(parsed.data);
}
