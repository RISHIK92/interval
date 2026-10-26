import { z } from "zod";
import { INVITE_MESSAGES, redeemInvite } from "./invites";
import { log } from "./log";
import {
  AccountNotRemoved,
  type Accounts,
  type Actor,
  type InviteCodes,
} from "./ports";

type FormResult = { ok: true } | { ok: false; message: string };

const email = z.string().trim().toLowerCase().pipe(z.email());
// Better Auth's limits, set in adapters/better-auth.ts (owner choice, 2026-10-25).
const password = z.string().min(8).max(128);
const name = z.string().trim().min(1).max(80);

const BAD_EMAIL = "Enter a valid email address.";
const BAD_PASSWORD = "Use a password of 8 to 128 characters.";
const BAD_NAME = "Enter a name of up to 80 characters.";
const WRONG = "Email or password is incorrect.";
const SIGN_UP_REFUSED = {
  email_taken: "An account with that email already exists. Sign in instead.",
  not_a_guest: "Join with an invite code first.",
} as const;
const BAD_TOKEN = "That reset link is invalid or has expired.";

const refused = (message: string) => ({ ok: false as const, message });

// A use that can't be given back is logged, never thrown over the error that caused it.
async function releaseUse(
  codes: InviteCodes,
  inviteCodeId: string,
): Promise<void> {
  try {
    await codes.release(inviteCodeId);
  } catch (error) {
    log.error("join: invite use not given back", { inviteCodeId, error });
  }
}

// Account first (ADR-0016, owner 2026-10-26): the invite code and the account in one
// form. Details are checked before the code is spent; the use is given back when the
// account can't be made.
export async function joinWithInvite(
  deps: { codes: InviteCodes; accounts: Pick<Accounts, "create"> },
  raw: { code: string; name: string; email: string; password: string },
  headers: Headers,
): Promise<
  | { ok: true; setCookies: string[]; actor: Actor }
  | { ok: false; message: string }
> {
  const parsedName = name.safeParse(raw.name);
  if (!parsedName.success) return refused(BAD_NAME);
  const parsedEmail = email.safeParse(raw.email);
  if (!parsedEmail.success) return refused(BAD_EMAIL);
  if (!password.safeParse(raw.password).success) return refused(BAD_PASSWORD);
  const redemption = await redeemInvite(deps.codes, raw.code);
  if (!redemption.ok) return refused(INVITE_MESSAGES[redemption.reason]);
  let result;
  try {
    result = await deps.accounts.create(
      redemption,
      {
        name: parsedName.data,
        email: parsedEmail.data,
        password: raw.password,
      },
      headers,
    );
  } catch (error) {
    if (error instanceof AccountNotRemoved) {
      log.error("join: account half made and kept; its use stays spent", {
        inviteCodeId: redemption.inviteCodeId,
        error,
      });
      throw error;
    }
    log.error("join: account creation failed; releasing the use", {
      inviteCodeId: redemption.inviteCodeId,
      error,
    });
    await releaseUse(deps.codes, redemption.inviteCodeId);
    throw error;
  }
  if (!result.ok) {
    await releaseUse(deps.codes, redemption.inviteCodeId);
    return refused(SIGN_UP_REFUSED.email_taken);
  }
  return result;
}

// Dormant since ADR-0016 (option B): there are no guests to upgrade.
export async function signUp(
  accounts: Accounts,
  headers: Headers,
  raw: { name: string; email: string; password: string },
): Promise<FormResult> {
  const parsedName = name.safeParse(raw.name);
  if (!parsedName.success) return refused(BAD_NAME);
  const parsedEmail = email.safeParse(raw.email);
  if (!parsedEmail.success) return refused(BAD_EMAIL);
  if (!password.safeParse(raw.password).success) return refused(BAD_PASSWORD);
  const result = await accounts.signUp(headers, {
    name: parsedName.data,
    email: parsedEmail.data,
    password: raw.password,
  });
  return result.ok ? { ok: true } : refused(SIGN_UP_REFUSED[result.reason]);
}

// Malformed input gets the wrong-password message, so it reveals nothing either.
export async function signIn(
  accounts: Accounts,
  headers: Headers,
  raw: { email: string; password: string },
): Promise<{ ok: true; actor: Actor } | { ok: false; message: string }> {
  const parsedEmail = email.safeParse(raw.email);
  if (!parsedEmail.success || raw.password.length > 128) return refused(WRONG);
  const session = await accounts.signIn(
    headers,
    parsedEmail.data,
    raw.password,
  );
  return session === null
    ? { ok: false, message: WRONG }
    : { ok: true, actor: session.actor };
}

// The page says the same thing whatever happens here, so a malformed email is dropped.
export async function requestReset(
  accounts: Accounts,
  rawEmail: string,
): Promise<void> {
  const parsed = email.safeParse(rawEmail);
  if (parsed.success) await accounts.requestReset(parsed.data);
}

export async function resetPassword(
  accounts: Accounts,
  token: string,
  newPassword: string,
): Promise<FormResult> {
  if (!password.safeParse(newPassword).success) return refused(BAD_PASSWORD);
  return (await accounts.resetPassword(token, newPassword))
    ? { ok: true }
    : refused(BAD_TOKEN);
}
