// Ports (ADR-0012): what server logic and pages depend on. Adapters implement them;
// container.ts wires them. Nothing outside adapters/ imports kysely or pg.

import type { Capability, Difficulty } from "@interval/db";
import type { MessageName, Messages } from "@interval/db/messages";
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

// OPS-3, Q-P1-22: features ask what a user may do; plans and grants live in the database.
// Capability is the generated enum, so an unknown capability does not compile.
export interface Entitlements {
  can(userId: string, capability: Capability): Promise<boolean>;
  // The plan's limit; null when the capability has no limit, 0 when it isn't granted.
  // Compare as `limit === null || used < limit`: `used < (limit ?? 0)` would turn "no
  // limit" into "none allowed".
  limit(userId: string, capability: Capability): Promise<number | null>;
}

// ADR-0014: the enqueue side of the queue port (BullMQ on Valkey, or SQS). Messages are
// the schemas in packages/db/messages; the worker consumes them.
export interface JobQueue {
  enqueue<N extends MessageName>(
    name: N,
    message: Messages[N],
    options: { idempotencyKey: string; delaySeconds?: number },
  ): Promise<void>;
}

// ING-6, Q-P1-29: what the admin review page reads and writes (P1-W3-S05). Section
// headings and counts only; never body text (Q-P1-01).
export type ReviewTags = { difficulty: Difficulty; concepts: string[] };

export type ReviewItem = {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  // Section headings in page order; null for the intro.
  sections: {
    heading: string | null;
    level: number | null;
    wordCount: number;
  }[];
  // heading is null for the intro moment, which starts at the top of the page.
  moments: {
    ordinal: number;
    title: string;
    heading: string | null;
    estimatedMinutes: number;
    oversized: boolean;
  }[];
  // The model's tags (AI-3); moment tags by ordinal.
  modelTags: { item: ReviewTags | null; moments: Map<number, ReviewTags> };
  // The admin's corrections, kept apart and keyed by heading so they survive
  // re-ingestion: boundaries are the headings moments start at; tag overrides are by
  // heading, "" for the item itself.
  boundaries: string[] | null;
  tagOverrides: Map<string, ReviewTags>;
};

export type ReviewListing = {
  id: string;
  title: string;
  sourceName: string;
  momentCount: number;
};

export interface AdminReview {
  recent(limit: number): Promise<ReviewListing[]>;
  item(id: string): Promise<ReviewItem | null>;
  // Slugs of the concepts that may be tagged (not retired).
  activeConcepts(): Promise<string[]>;
  // null clears the override, so the 2-8 minute rules apply again.
  setBoundaries(
    itemId: string,
    headings: string[] | null,
    by: string,
  ): Promise<void>;
  // heading "" is the item itself; null clears the override.
  setTags(
    itemId: string,
    heading: string,
    tags: ReviewTags | null,
    by: string,
  ): Promise<void>;
}

// §3.2, P1-W3-S06: the per-source moments switch. The seed file owns every other
// setting, including whether a source is polled at all (ADR-0006 C-28).
export type SourceSwitch = {
  id: string;
  name: string;
  rightsProfile: string;
  active: boolean;
  // What the seed file says, whether an admin switched moments off, and the result.
  momentsSeeded: boolean;
  momentsSwitchedOff: boolean;
  momentsEnabled: boolean;
};

export interface AdminSources {
  list(): Promise<SourceSwitch[]>;
  get(id: string): Promise<SourceSwitch | null>;
  // Switching off removes the source's moments at once (the database's purge trigger).
  setMomentsSwitchedOff(id: string, off: boolean, by: string): Promise<void>;
  // Items whose stored full text can be segmented again when moments come back.
  fullTextItemIds(id: string): Promise<string[]>;
}
