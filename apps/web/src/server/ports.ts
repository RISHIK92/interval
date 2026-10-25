// Ports (ADR-0012): what server logic and pages depend on. Adapters implement them;
// container.ts wires them. Nothing outside adapters/ imports kysely or pg.

import type { Envelope } from "@interval/events";

// What a card may show (§3.2, ING-2): no summary or body text.
export type FeedCard = {
  momentId: string;
  sectionTitle: string;
  sectionNumber: number;
  sectionCount: number;
  estimatedMinutes: number;
  link: string;
  articleTitle: string;
  author: string | null;
  sourceName: string;
};

export interface FeedReader {
  list(limit: number): Promise<FeedCard[]>;
}

export interface DatabasePing {
  // Resolves when the database answers; rejects otherwise.
  ping(): Promise<void>;
}

export type BetaGroup = "student" | "developer";

// Q-P1-24: any access in the private beta needs a code; the code sets the group.
export type Redemption =
  | { ok: true; inviteCodeId: string; betaGroup: BetaGroup }
  | { ok: false; reason: "unknown" | "expired" | "used_up" };

export interface InviteCodes {
  // Consumes one use when the code is valid; never consumes on failure. Better Auth
  // creates users in its own transactions, so a guest start that fails afterwards
  // gives the use back with release() (owner choice, 2026-10-25).
  redeem(code: string): Promise<Redemption>;
  // Gives back one use after a redeem whose user creation failed; never below zero.
  release(inviteCodeId: string): Promise<void>;
}

export type Actor = { userId: string; isGuest: boolean; betaGroup: BetaGroup };

// Guest creation failed after the user row was written, and removing that row failed
// too: the guest holds the code's use, so it must not be released.
export class GuestNotRemoved extends Error {
  override name = "GuestNotRemoved";
}

export interface GuestSessions {
  // Creates a guest (anonymous user) in the redemption's beta group and returns it with
  // the Set-Cookie values for its session. If it throws anything but GuestNotRemoved, no
  // user was left behind.
  start(
    redemption: Extract<Redemption, { ok: true }>,
    headers: Headers,
  ): Promise<{ setCookies: string[]; actor: Actor }>;
}

export interface SessionReader {
  current(headers: Headers): Promise<Actor | null>;
}

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export type SignUpResult =
  | { ok: true; setCookies: string[] }
  | { ok: false; reason: "not_a_guest" | "email_taken" };

// Email-and-password accounts (ADR-0004). Inputs arrive validated and normalised.
// Sign-up and sign-in return the new session's Set-Cookie values, like GuestSessions.
export interface Accounts {
  // Turns the current guest into the account, keeping its user id, code and group
  // (Q-P1-11, Q-P1-24), and replaces the guest's session with a new one.
  signUp(
    headers: Headers,
    input: { name: string; email: string; password: string },
  ): Promise<SignUpResult>;
  // Null for an unknown email or a wrong password: the caller cannot tell which.
  signIn(
    headers: Headers,
    email: string,
    password: string,
  ): Promise<{ setCookies: string[]; actor: Actor } | null>;
  signOut(headers: Headers): Promise<void>;
  // Mails a reset link if the account exists; returns the same either way.
  requestReset(email: string): Promise<void>;
  // False for an unknown, used or expired token.
  resetPassword(token: string, newPassword: string): Promise<boolean>;
}

// DB-5: where events go. Returns the records it could not deliver, for one retry.
export interface EventSink {
  write(batch: Envelope[]): Promise<{ failed: Envelope[] }>;
}
