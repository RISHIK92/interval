import { AsyncLocalStorage } from "node:async_hooks";
import type { DB } from "@interval/db";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins";
import type { Kysely } from "kysely";
import { z } from "zod";
import { log } from "../log";
import {
  GuestNotRemoved,
  type Actor,
  type GuestSessions,
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
}) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: { db: opts.db, type: "postgres" },
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
        return { setCookies: result.headers.getSetCookie() };
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
