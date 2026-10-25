import { redeemInvite } from "./invites";
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

// Unknown and expired share a message, so a guess cannot tell the two apart.
const INVALID = "That invite code isn't valid.";
const USED_UP = "That invite code has no uses left.";

// Q-P1-24: a guest exists only through a redeemed invite code. The use is spent first;
// if creating the guest then fails, it is given back (owner choice, 2026-10-25).
export async function startGuest(
  deps: { codes: InviteCodes; guests: GuestSessions },
  rawCode: string,
  headers: Headers,
): Promise<GuestStart> {
  const redemption = await redeemInvite(deps.codes, rawCode);
  if (!redemption.ok) {
    return {
      ok: false,
      message: redemption.reason === "used_up" ? USED_UP : INVALID,
    };
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
