import { INVITE_MESSAGES, redeemInvite } from "./invites";
import { log } from "./log";
import {
  type Actor,
  GuestNotRemoved,
  type GuestSessions,
  type InviteCodes,
} from "./ports";

export type GuestStart =
  | { ok: true; setCookies: string[]; actor: Actor }
  | { ok: false; message: string };

// Q-P1-24: a guest exists only through a redeemed invite code. The use is spent first;
// if creating the guest then fails, it is given back (owner choice, 2026-10-25).
// Dormant since ADR-0016 (account first, option B): nothing calls it now.
export async function startGuest(
  deps: { codes: InviteCodes; guests: GuestSessions },
  rawCode: string,
  headers: Headers,
): Promise<GuestStart> {
  const redemption = await redeemInvite(deps.codes, rawCode);
  if (!redemption.ok) {
    return { ok: false, message: INVITE_MESSAGES[redemption.reason] };
  }
  try {
    const { setCookies, actor } = await deps.guests.start(redemption, headers);
    return { ok: true, setCookies, actor };
  } catch (error) {
    if (error instanceof GuestNotRemoved) {
      log.error("guest: creation failed after redeem; a guest holds the use", {
        inviteCodeId: redemption.inviteCodeId,
        error,
      });
      throw error;
    }
    log.error("guest: creation failed after redeem; releasing the use", {
      inviteCodeId: redemption.inviteCodeId,
      error,
    });
    await deps.codes.release(redemption.inviteCodeId);
    throw error;
  }
}
