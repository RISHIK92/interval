import { AsyncLocalStorage } from "node:async_hooks";
import type { DB } from "@interval/db";
import { APIError, betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins";
import type { Kysely } from "kysely";
import { DatabaseError } from "pg";
import { z } from "zod";
import { log } from "../log";
import {
  AccountNotRemoved,
  GuestNotRemoved,
  type Accounts,
  type Actor,
  type GuestSessions,
  type Mailer,
  type Redemption,
  type SessionReader,
} from "../ports";

// Better Auth (ADR-0004) on our own tables (P1-W1-S13 migration). Pinned at 1.7.12:
// the migration matches that version's getAuthTables(); re-check before upgrading.

const DAY_SECONDS = 60 * 60 * 24;

type Redeemed = Extract<Redemption, { ok: true }>;

// The redemption being turned into a user, and the user once its row exists. No
// redemption, no user (Q-P1-24): the create hook below refuses any user created
// outside this scope.
type PendingGuest = { redemption: Redeemed; userId?: string };
const pendingGuest = new AsyncLocalStorage<PendingGuest>();

const betaGroup = z.enum(["student", "developer"]);

const timestamps = {
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const;

export function createAuth(opts: {
  db: Kysely<DB>;
  secret: string;
  baseURL: string;
  mailer: Mailer;
}) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: { db: opts.db, type: "postgres" },
    // ADR-0004, owner choices 2026-10-25: 8 to 128 characters, no email verification
    // in Phase 1, a reset link valid for an hour that signs out every other session.
    emailAndPassword: {
      enabled: true,
      // Accounts are made only from an invite redemption (Accounts.create, ADR-0016),
      // never through the public endpoint, which would skip the invite code, or by a
      // Play guest's upgrade (Accounts.signUp, ADR-0029).
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      // A failed send must answer like an unknown email (Better Auth then replies the
      // same either way), and the failure goes to our log, never the link.
      sendResetPassword: async ({ user, url }) => {
        try {
          await opts.mailer.send({
            to: user.email,
            subject: "Reset your Interval password",
            text: `Open this link within an hour to choose a new password:\n${url}\n\nIf you didn't ask for this, ignore this email.`,
          });
        } catch (error) {
          log.error("account: reset mail failed", { userId: user.id, error });
        }
      },
    },
    user: {
      modelName: "app_user",
      fields: { emailVerified: "email_verified", ...timestamps },
      additionalFields: {
        betaGroup: {
          type: "string",
          fieldName: "beta_group",
          input: false,
          required: false,
        },
        inviteCodeId: {
          type: "string",
          fieldName: "invite_code_id",
          input: false,
          required: false,
        },
      },
    },
    session: {
      modelName: "auth_session",
      fields: {
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
        ...timestamps,
      },
      // Q-P1-12: 30 days, sliding: each use more than a day after the last refresh
      // pushes expiry back to 30 days.
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
    },
    account: {
      modelName: "auth_account",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        ...timestamps,
      },
    },
    verification: {
      modelName: "auth_verification",
      fields: { expiresAt: "expires_at", ...timestamps },
    },
    databaseHooks: {
      user: {
        create: {
          before: (user) => {
            const pending = pendingGuest.getStore();
            if (pending === undefined) return Promise.resolve(false);
            return Promise.resolve({
              data: {
                ...user,
                betaGroup: pending.redemption.betaGroup,
                inviteCodeId: pending.redemption.inviteCodeId,
              },
            });
          },
          // Better Auth commits the user before creating its session; if that later
          // step fails, start() removes this user so the code's count stays exact.
          after: (user) => {
            const pending = pendingGuest.getStore();
            if (pending !== undefined) pending.userId = user.id;
            return Promise.resolve();
          },
        },
      },
    },
    plugins: [
      anonymous({
        schema: { user: { fields: { isAnonymous: "is_anonymous" } } },
        // A guest who signs in to an existing account is kept for the merge (S12),
        // and nobody deletes a guest through the API.
        disableDeleteAnonymousUser: true,
      }),
      // Lets Better Auth set cookies from Next server actions; keep last.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

export function guestSessions(auth: Auth): GuestSessions {
  return {
    start: async (redemption, headers) => {
      const pending: PendingGuest = { redemption };
      try {
        const result = await pendingGuest.run(pending, () =>
          auth.api.signInAnonymous({ headers, returnHeaders: true }),
        );
        return {
          setCookies: result.headers.getSetCookie(),
          actor: {
            userId: result.response.user.id,
            isGuest: true,
            betaGroup: redemption.betaGroup,
          },
        };
      } catch (error) {
        if (pending.userId !== undefined) {
          await removeHalfMadeGuest(auth, pending.userId, error);
        }
        throw error;
      }
    },
  };
}

async function removeHalfMadeGuest(
  auth: Auth,
  userId: string,
  cause: unknown,
): Promise<void> {
  try {
    const context = await auth.$context;
    await context.internalAdapter.deleteUser(userId);
  } catch (error) {
    log.error("guest: could not remove a half-made guest", { userId, error });
    throw new GuestNotRemoved("guest creation failed and its user remains", {
      cause,
    });
  }
}

const RESET_PATH = "/reset-password";

function isEmailTaken(error: unknown): boolean {
  return (
    error instanceof DatabaseError &&
    error.code === "23505" &&
    error.constraint === "app_user_email_key"
  );
}

export function accounts(auth: Auth, db: Kysely<DB>): Accounts {
  return {
    // Account first (ADR-0016): the user and its password together, then a session.
    create: async (redemption, input, headers) => {
      const context = await auth.$context;
      const hash = await context.password.hash(input.password);
      const userId = context.generateId({ model: "user" });
      const credentialId = context.generateId({ model: "account" });
      if (userId === false || credentialId === false) {
        throw new Error("Better Auth gave no id");
      }
      try {
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto("app_user")
            .values({
              id: userId,
              name: input.name,
              email: input.email,
              is_anonymous: false,
              beta_group: redemption.betaGroup,
              invite_code_id: redemption.inviteCodeId,
            })
            .execute();
          await trx
            .insertInto("auth_account")
            .values({
              id: credentialId,
              account_id: userId,
              provider_id: "credential",
              user_id: userId,
              password: hash,
              updated_at: new Date(),
            })
            .execute();
        });
      } catch (error) {
        if (isEmailTaken(error)) return { ok: false, reason: "email_taken" };
        throw error;
      }
      // Without any cookie the visitor brought: a plain sign-in for the new account.
      const fresh = new Headers(headers);
      fresh.delete("cookie");
      try {
        const signedIn = await auth.api.signInEmail({
          body: { email: input.email, password: input.password },
          headers: fresh,
          returnHeaders: true,
        });
        const { user } = signedIn.response;
        return {
          ok: true,
          setCookies: signedIn.headers.getSetCookie(),
          actor: {
            userId: user.id,
            isGuest: false,
            betaGroup: betaGroup.parse(user.betaGroup),
          },
        };
      } catch (error) {
        // Nothing left behind (credentials and sessions cascade), so the caller can give
        // the invite use back; if even that fails, it must not.
        try {
          await db.deleteFrom("app_user").where("id", "=", userId).execute();
        } catch (cleanup) {
          log.error("account: sign-in failed and the new account remains", {
            userId,
            error,
            cleanup,
          });
          throw new AccountNotRemoved(
            "account creation failed and its user remains",
            {
              cause: error,
            },
          );
        }
        throw error;
      }
    },
    signUp: async (headers, input) => {
      const current = await auth.api.getSession({ headers });
      if (current?.user.isAnonymous !== true) {
        return { ok: false, reason: "not_a_guest" };
      }
      const userId = current.user.id;
      const context = await auth.$context;
      const hash = await context.password.hash(input.password);
      try {
        // One transaction: the row turns into the account and gets its password
        // together, or neither happens. Same user id (Q-P1-11).
        await db.transaction().execute(async (trx) => {
          const upgraded = await trx
            .updateTable("app_user")
            .set({
              name: input.name,
              email: input.email,
              is_anonymous: false,
              updated_at: new Date(),
            })
            .where("id", "=", userId)
            .where("is_anonymous", "=", true)
            .executeTakeFirst();
          if (upgraded.numUpdatedRows !== 1n) throw new NotAGuest();
          const id = context.generateId({ model: "account" });
          if (id === false) throw new Error("Better Auth gave no account id");
          await trx
            .insertInto("auth_account")
            .values({
              id,
              account_id: userId,
              provider_id: "credential",
              user_id: userId,
              password: hash,
              updated_at: new Date(),
            })
            .execute();
        });
      } catch (error) {
        if (error instanceof NotAGuest)
          return { ok: false, reason: "not_a_guest" };
        if (isEmailTaken(error)) return { ok: false, reason: "email_taken" };
        throw error;
      }
      // A new session for the new privilege; the guest's token must not carry over.
      // Without the cookie, so the anonymous plugin sees a plain sign-in; the rest of
      // the request (user agent, address) is recorded on the session as usual.
      const fresh = new Headers(headers);
      fresh.delete("cookie");
      try {
        const signedIn = await auth.api.signInEmail({
          body: { email: input.email, password: input.password },
          headers: fresh,
          returnHeaders: true,
        });
        await context.internalAdapter.deleteSession(current.session.token);
        return { ok: true, setCookies: signedIn.headers.getSetCookie() };
      } catch (error) {
        // The account exists now; the owner can sign in with the new password.
        log.error("account: upgraded but session rotation failed", {
          userId,
          error,
        });
        throw error;
      }
    },
    signIn: async (headers, email, password) => {
      try {
        const result = await auth.api.signInEmail({
          body: { email, password },
          headers,
          returnHeaders: true,
        });
        const { user } = result.response;
        return {
          setCookies: result.headers.getSetCookie(),
          actor: {
            userId: user.id,
            isGuest: user.isAnonymous === true,
            betaGroup: betaGroup.parse(user.betaGroup),
          },
        };
      } catch (error) {
        if (error instanceof APIError && error.statusCode === 401) return null;
        throw error;
      }
    },
    signOut: async (headers) => {
      await auth.api.signOut({ headers });
    },
    requestReset: async (email) => {
      await auth.api.requestPasswordReset({
        body: { email, redirectTo: RESET_PATH },
      });
    },
    resetPassword: async (token, newPassword) => {
      try {
        await auth.api.resetPassword({ body: { token, newPassword } });
        return true;
      } catch (error) {
        if (error instanceof APIError && error.statusCode === 400) return false;
        throw error;
      }
    },
  };
}

class NotAGuest extends Error {}

export function sessionReader(auth: Auth): SessionReader {
  return {
    current: async (headers): Promise<Actor | null> => {
      const found = await auth.api.getSession({ headers });
      if (found === null) return null;
      const { user } = found;
      return {
        userId: user.id,
        isGuest: user.isAnonymous === true,
        betaGroup: betaGroup.parse(user.betaGroup),
      };
    },
  };
}
