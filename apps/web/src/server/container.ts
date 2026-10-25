import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import { env } from "../env";
import {
  type Auth,
  accounts as betterAuthAccounts,
  createAuth,
  guestSessions as betterAuthGuests,
  sessionReader as betterAuthSessions,
} from "./adapters/better-auth";
import {
  createDb,
  kyselyFeedReader,
  kyselyInviteCodes,
  kyselyPing,
} from "./adapters/kysely";
import { logMailer } from "./adapters/log-mailer";
import type {
  Accounts,
  DatabasePing,
  FeedReader,
  GuestSessions,
  InviteCodes,
  SessionReader,
} from "./ports";

// Composition root (ADR-0012): the only place that picks adapters. Lazy, because
// `next build` imports route modules without a runtime environment.
let database: Kysely<DB> | undefined;
let authInstance: Auth | undefined;

function db(): Kysely<DB> {
  database ??= createDb(env().DATABASE_URL);
  return database;
}

export function auth(): Auth {
  authInstance ??= createAuth({
    db: db(),
    secret: env().BETTER_AUTH_SECRET,
    baseURL: env().BETTER_AUTH_URL,
    // MAIL_TRANSPORT has one value until the SES adapter exists (pre-deploy list).
    mailer: logMailer(),
  });
  return authInstance;
}

export function feedReader(): FeedReader {
  return kyselyFeedReader(db());
}

export function databasePing(): DatabasePing {
  return kyselyPing(db());
}

export function inviteCodes(): InviteCodes {
  return kyselyInviteCodes(db());
}

export function guestSessions(): GuestSessions {
  return betterAuthGuests(auth());
}

export function sessionReader(): SessionReader {
  return betterAuthSessions(auth());
}

export function accounts(): Accounts {
  return betterAuthAccounts(auth(), db());
}
