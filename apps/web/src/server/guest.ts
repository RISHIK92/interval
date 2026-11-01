import { INVITE_MESSAGES, redeemInvite } from "./invites";
import { log } from "./log";
import {
  type Actor,
  type GuestLimits,
  GuestNotRemoved,
  type GuestSessions,
  type InviteCodes,
} from "./ports";

export type GuestStart =
  | { ok: true; setCookies: string[]; actor: Actor }
  | { ok: false; message: string };

// Q-P1-24: a guest exists only through a redeemed invite code. The use is spent first;
// if creating the guest then fails, it is given back (owner choice, 2026-10-25).
// ADR-0029: guests are for Play only (app/play/actions.ts), at most 10 a day from one
// network (P3-W13-S07), checked first so a refused start spends no code use; only a
// guest that started counts.
export async function startGuest(
  deps: { codes: InviteCodes; guests: GuestSessions; limits: GuestLimits },
  rawCode: string,
  headers: Headers,
  ip: string,
): Promise<GuestStart> {
  if (!(await deps.limits.allow(ip)))
    return {
      ok: false,
      message:
        "Too many guests from this network today. Sign in, or try again tomorrow.",
    };
  const redemption = await redeemInvite(deps.codes, rawCode);
  if (!redemption.ok) {
    return { ok: false, message: INVITE_MESSAGES[redemption.reason] };
  }
  let started: Awaited<ReturnType<GuestSessions["start"]>>;
  try {
    started = await deps.guests.start(redemption, headers);
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
  // The guest exists and holds the use: an uncounted start costs only a little of the
  // limit, while failing here would strand a guest no browser holds.
  try {
    await deps.limits.record(ip);
  } catch (error) {
    log.error("guest: start not counted toward the network's limit", { error });
  }
  return { ok: true, ...started };
}
