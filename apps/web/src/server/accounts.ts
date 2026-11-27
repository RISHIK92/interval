import { z } from "zod";
import type { Emitter, EventContext } from "./events";
import { redeemInvite } from "./invites";
import { log } from "./log";
import {
  AccountNotRemoved,
  type Accounts,
  type Actor,
  type InviteCodes,
  type RateLimits,
  type Redemption,
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
  not_a_guest: "Your guest session ended. Create your account from Join.",
} as const;
const BAD_TOKEN = "That reset link is invalid or has expired.";
const NO_ACCOUNT = "No account with that email.";
const TOO_MANY_ACCOUNTS =
  "Too many new accounts from this network. Try again in an hour.";

// Q-P7-05: Profile's "Verify your email" sends at most this many links an hour per
// account (Valkey, as sign-ups), so the button can't flood an inbox.
export const VERIFY_LINKS_PER_HOUR = 3;

// ADR-0056: with no invite code to spend, the network's sign-ups are the throttle on
// new accounts. If the limit can't be read (Valkey down), sign-up fails rather than run
// unthrottled: the error reaches the log like any other. Attempts with valid details count, refused ones included (owner may set
// another number, ADR-0056's open question).
export const ACCOUNTS_PER_NETWORK_HOUR = 30;

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

// ADR-0056: a code is optional. A valid one (from a /join?code= link sent during the
// private beta) still sets the group and spends a use; any other only means no group,
// never a refusal, since the form no longer shows the code to correct.
async function redeemIfGiven(
  codes: InviteCodes,
  raw: string,
): Promise<Extract<Redemption, { ok: true }> | null> {
  if (raw.trim() === "") return null;
  const redemption = await redeemInvite(codes, raw);
  if (redemption.ok) return redemption;
  log.info("join: invite code not used; the account has no group", {
    reason: redemption.reason,
  });
  return null;
}

// Q-P7-05 (owner, 2026-11-27): a new account is mailed a verification link after its
// response has gone (the caller runs this in Next's `after`), so sign-up never waits on
// mail. A failed send is tried again; the last failure is logged as "account:
// verification mail failed", a metric. Profile can always send another.
export const VERIFY_MAIL_TRIES = 3;
const VERIFY_RETRY_MS = 2000;
const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export async function mailVerificationOnSignUp(
  deps: {
    accounts: Pick<Accounts, "requestVerification">;
    events: Pick<Emitter, "emit">;
    wait?: (ms: number) => Promise<void>;
  },
  email: string,
  context: EventContext,
): Promise<boolean> {
  const wait = deps.wait ?? pause;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await deps.accounts.requestVerification(email);
      deps.events.emit(
        "email_verification_sent",
        { trigger: "sign_up" },
        context,
      );
      return true;
    } catch (error) {
      if (attempt >= VERIFY_MAIL_TRIES) {
        log.error("account: verification mail failed", {
          userId: context.userId,
          attempts: attempt,
          error,
        });
        return false;
      }
      log.warn("account: verification mail retrying", {
        userId: context.userId,
        attempt,
        error,
      });
      await wait(VERIFY_RETRY_MS * attempt);
    }
  }
}

// Account first (ADR-0016, owner 2026-10-26): the account in one form, open to anyone
// (ADR-0056). Details are checked before the network's limit or a code is touched; a
// code's use is given back when the account can't be made.
export async function createAccount(
  deps: {
    codes: InviteCodes;
    accounts: Pick<Accounts, "create">;
    limits: RateLimits;
  },
  raw: { code: string; name: string; email: string; password: string },
  headers: Headers,
  ip: string,
): Promise<
  | {
      ok: true;
      setCookies: string[];
      actor: Actor;
      // Normalised: where the verification link goes.
      email: string;
    }
  | { ok: false; message: string }
> {
  const parsedName = name.safeParse(raw.name);
  if (!parsedName.success) return refused(BAD_NAME);
  const parsedEmail = email.safeParse(raw.email);
  if (!parsedEmail.success) return refused(BAD_EMAIL);
  if (!password.safeParse(raw.password).success) return refused(BAD_PASSWORD);
  if (
    !(await deps.limits.allow(
      `sign-up:${ip}`,
      ACCOUNTS_PER_NETWORK_HOUR,
      60 * 60,
    ))
  )
    return refused(TOO_MANY_ACCOUNTS);
  const redemption = await redeemIfGiven(deps.codes, raw.code);
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
    if (redemption === null) throw error;
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
    if (redemption !== null)
      await releaseUse(deps.codes, redemption.inviteCodeId);
    return refused(SIGN_UP_REFUSED.email_taken);
  }
  return {
    ...result,
    email: parsedEmail.data,
  };
}

// A Play guest (ADR-0029) becomes an account in place, keeping its user id.
export async function signUp(
  accounts: Accounts,
  headers: Headers,
  raw: { name: string; email: string; password: string },
): Promise<{ ok: true; email: string } | { ok: false; message: string }> {
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
  if (!result.ok) return refused(SIGN_UP_REFUSED[result.reason]);
  return {
    ok: true,
    email: parsedEmail.data,
  };
}

// Q-P7-05: Profile's "Verify your email" for an account made before verification
// existed, or whose link expired. A mail that fails is logged and said.
export async function requestVerification(
  deps: {
    accounts: Pick<Accounts, "emailStatus" | "requestVerification">;
    limits: RateLimits;
  },
  userId: string,
): Promise<"sent" | "verified" | "too_many" | "failed" | "no_account"> {
  const status = await deps.accounts.emailStatus(userId);
  if (status === null) return "no_account";
  if (status.verified) return "verified";
  if (
    !(await deps.limits.allow(
      `verify-email:${userId}`,
      VERIFY_LINKS_PER_HOUR,
      60 * 60,
    ))
  )
    return "too_many";
  try {
    await deps.accounts.requestVerification(status.email);
  } catch (error) {
    log.error("account: verification mail failed", { userId, error });
    return "failed";
  }
  return "sent";
}

// Malformed input gets the wrong-password message, so it reveals nothing either.
export async function signIn(
  accounts: Accounts,
  headers: Headers,
  raw: { email: string; password: string },
): Promise<
  | { ok: true; actor: Actor; mergedGuest: boolean }
  | { ok: false; message: string }
> {
  const parsedEmail = email.safeParse(raw.email);
  if (!parsedEmail.success || raw.password.length > 128) return refused(WRONG);
  const session = await accounts.signIn(
    headers,
    parsedEmail.data,
    raw.password,
  );
  return session === null
    ? { ok: false, message: WRONG }
    : { ok: true, actor: session.actor, mergedGuest: session.mergedGuest };
}

// The page says the same thing whatever happens here, so a malformed email is dropped.
export async function requestReset(
  accounts: Accounts,
  rawEmail: string,
): Promise<void> {
  const parsed = email.safeParse(rawEmail);
  if (parsed.success) await accounts.requestReset(parsed.data);
}

// ADR-0030: on localhost only (the caller checks), no link: the email and a new
// password are enough.
export async function quickReset(
  accounts: Accounts,
  rawEmail: string,
  newPassword: string,
): Promise<FormResult> {
  const parsed = email.safeParse(rawEmail);
  if (!parsed.success) return refused(BAD_EMAIL);
  if (!password.safeParse(newPassword).success) return refused(BAD_PASSWORD);
  return (await accounts.setPassword(parsed.data, newPassword))
    ? { ok: true }
    : refused(NO_ACCOUNT);
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
