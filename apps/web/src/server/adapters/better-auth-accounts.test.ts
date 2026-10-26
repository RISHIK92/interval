import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import type { Mail, Mailer } from "../ports";
import {
  accounts,
  createAuth,
  guestSessions,
  sessionReader,
} from "./better-auth";
import { createDb } from "./kysely";

// Real Better Auth against the local database. Better Auth commits on its own
// connections, so every row made here hangs off a TESTACCT code and is removed after.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);
const sent: Mail[] = [];
const mailer: Mailer = {
  send: (mail) => {
    sent.push(mail);
    return Promise.resolve();
  },
};
const auth = createAuth({
  db,
  secret: "test-secret-test-secret-test-secret-0123",
  baseURL: "http://localhost:3100",
  mailer,
});
const guests = guestSessions(auth);
const sessions = sessionReader(auth);
const port = accounts(auth, db);
const PREFIX = "TESTACCT";
const PASSWORD = "correct horse battery";
let codeId = "";
let counter = 0;

async function cleanup(): Promise<void> {
  const users = db
    .selectFrom("app_user")
    .select("id")
    .where(
      "invite_code_id",
      "in",
      db
        .selectFrom("invite_code")
        .select("id")
        .where("code", "like", `${PREFIX}%`),
    );
  await db
    .deleteFrom("auth_verification")
    .where("value", "in", users)
    .execute();
  await db.deleteFrom("app_user").where("id", "in", users).execute();
  await db
    .deleteFrom("invite_code")
    .where("code", "like", `${PREFIX}%`)
    .execute();
}

beforeAll(async () => {
  await cleanup();
  const row = await db
    .insertInto("invite_code")
    .values({
      code: `${PREFIX}${String(Date.now()).slice(-6)}`,
      beta_group: "developer",
      max_uses: 100,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  codeId = row.id;
});

afterEach(() => {
  sent.length = 0;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanup();
  await db.destroy();
});

function cookieHeader(setCookies: string[]): Headers {
  const pairs = setCookies.map((c) => c.split(";")[0] ?? "");
  return new Headers({ cookie: pairs.join("; ") });
}

function email(): string {
  counter += 1;
  return `acct${String(counter)}-${String(Date.now())}@testacct.example.test`;
}

async function newGuest(): Promise<{ headers: Headers; userId: string }> {
  const { setCookies } = await guests.start(
    { ok: true, inviteCodeId: codeId, betaGroup: "developer" },
    new Headers(),
  );
  const headers = cookieHeader(setCookies);
  const actor = await sessions.current(headers);
  if (actor === null) throw new Error("no session after start");
  return { headers, userId: actor.userId };
}

async function newAccount(address = email()) {
  const guest = await newGuest();
  const result = await port.signUp(guest.headers, {
    name: "Ada",
    email: address,
    password: PASSWORD,
  });
  if (!result.ok) throw new Error(`sign-up refused: ${result.reason}`);
  return { ...guest, email: address, headers: cookieHeader(result.setCookies) };
}

async function signedIn(
  address: string,
  password: string,
): Promise<Headers | null> {
  const result = await port.signIn(new Headers(), address, password);
  if (result === null) return null;
  const headers = cookieHeader(result.setCookies);
  // signIn() reports the account it signed in, so callers need no second lookup.
  expect(result.actor).toEqual(await sessions.current(headers));
  return headers;
}

test("sign-up turns the guest into the account: same user, code and group", async () => {
  const guest = await newGuest();
  guest.headers.set("user-agent", "test-agent/1");
  const address = email();
  const result = await port.signUp(guest.headers, {
    name: "Ada",
    email: address,
    password: PASSWORD,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const user = await db
    .selectFrom("app_user")
    .select(["name", "email", "is_anonymous", "beta_group", "invite_code_id"])
    .where("id", "=", guest.userId)
    .executeTakeFirstOrThrow();
  expect(user).toEqual({
    name: "Ada",
    email: address,
    is_anonymous: false,
    beta_group: "developer",
    invite_code_id: codeId,
  });
  // The session is rotated: the guest cookie is dead, the new one is the account,
  // recorded with the request's user agent like any other session.
  expect(await sessions.current(guest.headers)).toBeNull();
  expect(await sessions.current(cookieHeader(result.setCookies))).toEqual({
    userId: guest.userId,
    isGuest: false,
    betaGroup: "developer",
  });
  const rows = await db
    .selectFrom("auth_session")
    .select("user_agent")
    .where("user_id", "=", guest.userId)
    .execute();
  expect(rows).toEqual([{ user_agent: "test-agent/1" }]);
});

test("an email already in use is refused and the guest stays a guest", async () => {
  const taken = await newAccount();
  const guest = await newGuest();
  expect(
    await port.signUp(guest.headers, {
      name: "B",
      email: taken.email,
      password: PASSWORD,
    }),
  ).toEqual({ ok: false, reason: "email_taken" });
  const row = await db
    .selectFrom("app_user")
    .select("is_anonymous")
    .where("id", "=", guest.userId)
    .executeTakeFirstOrThrow();
  expect(row.is_anonymous).toBe(true);
  const credentials = await db
    .selectFrom("auth_account")
    .select("id")
    .where("user_id", "=", guest.userId)
    .execute();
  expect(credentials).toEqual([]);
  expect(await sessions.current(guest.headers)).not.toBeNull();
});

test("only a guest can sign up", async () => {
  const account = await newAccount();
  for (const headers of [new Headers(), account.headers]) {
    expect(
      await port.signUp(headers, {
        name: "C",
        email: email(),
        password: PASSWORD,
      }),
    ).toEqual({ ok: false, reason: "not_a_guest" });
  }
});

// Account-first join (ADR-0016): a new account straight from an invite redemption.
test("create makes a signed-in account in the code's group, with its code", async () => {
  const address = email();
  const result = await port.create(
    { ok: true, inviteCodeId: codeId, betaGroup: "developer" },
    { name: "Grace", email: address, password: PASSWORD },
    new Headers(),
  );
  if (!result.ok) throw new Error(`create refused: ${result.reason}`);
  expect(result.actor).toMatchObject({
    isGuest: false,
    betaGroup: "developer",
  });
  expect(await sessions.current(cookieHeader(result.setCookies))).toEqual(
    result.actor,
  );
  const row = await db
    .selectFrom("app_user")
    .select(["is_anonymous", "invite_code_id", "beta_group", "name"])
    .where("id", "=", result.actor.userId)
    .executeTakeFirstOrThrow();
  expect(row).toEqual({
    is_anonymous: false,
    invite_code_id: codeId,
    beta_group: "developer",
    name: "Grace",
  });
  expect(await signedIn(address, PASSWORD)).not.toBeNull();
});

test("create refuses an email in use and leaves no user behind", async () => {
  const taken = await newAccount();
  expect(
    await port.create(
      { ok: true, inviteCodeId: codeId, betaGroup: "developer" },
      { name: "Dup", email: taken.email, password: PASSWORD },
      new Headers(),
    ),
  ).toEqual({ ok: false, reason: "email_taken" });
  const named = await db
    .selectFrom("app_user")
    .select("id")
    .where("name", "=", "Dup")
    .where("invite_code_id", "=", codeId)
    .execute();
  expect(named).toEqual([]);
});

test("when sign-in fails after create, the new account is removed", async () => {
  const address = email();
  vi.spyOn(auth.api, "signInEmail").mockRejectedValueOnce(
    new Error("no session"),
  );
  await expect(
    port.create(
      { ok: true, inviteCodeId: codeId, betaGroup: "developer" },
      { name: "Gone", email: address, password: PASSWORD },
      new Headers(),
    ),
  ).rejects.toThrow("no session");
  const rows = await db
    .selectFrom("app_user")
    .select("id")
    .where("email", "=", address)
    .execute();
  expect(rows).toEqual([]);
  const credentials = await db
    .selectFrom("auth_account")
    .innerJoin("app_user", "app_user.id", "auth_account.user_id")
    .select("auth_account.id")
    .where("app_user.email", "=", address)
    .execute();
  expect(credentials).toEqual([]);
});

test("Better Auth's own sign-up endpoint is closed", async () => {
  await expect(
    auth.api.signUpEmail({
      body: { name: "D", email: email(), password: PASSWORD },
    }),
  ).rejects.toMatchObject({ statusCode: 400 });
});

test("sign-in works with the right password and fails with a wrong one", async () => {
  const account = await newAccount();
  const headers = await signedIn(account.email, PASSWORD);
  expect(headers).not.toBeNull();
  if (headers === null) return;
  expect((await sessions.current(headers))?.userId).toBe(account.userId);
  expect(await signedIn(account.email, "wrong password!")).toBeNull();
  expect(await signedIn("nobody@testacct.example.test", PASSWORD)).toBeNull();
});

test("sign-out ends the session", async () => {
  const account = await newAccount();
  await port.signOut(account.headers);
  expect(await sessions.current(account.headers)).toBeNull();
  const rows = await db
    .selectFrom("auth_session")
    .select("id")
    .where("user_id", "=", account.userId)
    .execute();
  expect(rows).toEqual([]);
});

function resetToken(): string {
  expect(sent).toHaveLength(1);
  const match = /\/api\/auth\/reset-password\/([^?\s]+)/.exec(
    sent[0]?.text ?? "",
  );
  if (match?.[1] === undefined) throw new Error("no reset link in the mail");
  return match[1];
}

test("a reset link sets a new password once and signs out every other session", async () => {
  const account = await newAccount();
  const elsewhere = await signedIn(account.email, PASSWORD);
  if (elsewhere === null) throw new Error("second sign-in failed");
  await port.requestReset(account.email);
  expect(sent[0]?.to).toBe(account.email);
  const token = resetToken();
  const newPassword = "a brand new passphrase";
  expect(await port.resetPassword(token, newPassword)).toBe(true);
  expect(await port.resetPassword(token, "another passphrase")).toBe(false);
  expect(await signedIn(account.email, PASSWORD)).toBeNull();
  expect(await signedIn(account.email, newPassword)).not.toBeNull();
  expect(await sessions.current(account.headers)).toBeNull();
  expect(await sessions.current(elsewhere)).toBeNull();
});

test("an expired reset link is refused", async () => {
  const account = await newAccount();
  await port.requestReset(account.email);
  const token = resetToken();
  await db
    .updateTable("auth_verification")
    .set({ expires_at: sql<Date>`now() - interval '1 second'` })
    .where("identifier", "=", `reset-password:${token}`)
    .execute();
  expect(await port.resetPassword(token, "a brand new passphrase")).toBe(false);
  expect(await signedIn(account.email, PASSWORD)).not.toBeNull();
});

test("a failing mailer does not reveal whether the account exists", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const failingPort = accounts(
    createAuth({
      db,
      secret: "test-secret-test-secret-test-secret-0123",
      baseURL: "http://localhost:3100",
      mailer: { send: () => Promise.reject(new Error("mail down")) },
    }),
    db,
  );
  const account = await newAccount();
  await expect(
    failingPort.requestReset(account.email),
  ).resolves.toBeUndefined();
  await expect(
    failingPort.requestReset("nobody@testacct.example.test"),
  ).resolves.toBeUndefined();
});

test("two sign-ups from one guest at once: one wins, the other is refused", async () => {
  const guest = await newGuest();
  const results = await Promise.all(
    [email(), email()].map((address) =>
      port.signUp(guest.headers, {
        name: "R",
        email: address,
        password: PASSWORD,
      }),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toEqual([
    { ok: false, reason: "not_a_guest" },
  ]);
  const credentials = await db
    .selectFrom("auth_account")
    .select("id")
    .where("user_id", "=", guest.userId)
    .execute();
  expect(credentials).toHaveLength(1);
});

test("a reset for an unknown email sends nothing and does not say so", async () => {
  await expect(
    port.requestReset("nobody@testacct.example.test"),
  ).resolves.toBeUndefined();
  expect(sent).toEqual([]);
});

test("a made-up reset token is refused", async () => {
  expect(
    await port.resetPassword("not-a-real-token", "a brand new passphrase"),
  ).toBe(false);
});

test("a guest who signs in to an existing account is kept for the merge (S12)", async () => {
  const account = await newAccount();
  const guest = await newGuest();
  const result = await port.signIn(guest.headers, account.email, PASSWORD);
  expect(result).not.toBeNull();
  const row = await db
    .selectFrom("app_user")
    .select("is_anonymous")
    .where("id", "=", guest.userId)
    .executeTakeFirst();
  expect(row).toEqual({ is_anonymous: true });
});

test("passwords are stored hashed and never written to the log", async () => {
  const written: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  const account = await newAccount();
  await signedIn(account.email, "wrong password!");
  await port.requestReset(account.email);
  await port.resetPassword(resetToken(), "a brand new passphrase");
  const stored = await db
    .selectFrom("auth_account")
    .select("password")
    .where("user_id", "=", account.userId)
    .executeTakeFirstOrThrow();
  // Better Auth's scrypt format, salt:hash in hex, holding none of the passwords.
  expect(stored.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  const log = written.join("");
  for (const secret of [
    PASSWORD,
    "wrong password!",
    "a brand new passphrase",
  ]) {
    expect(log).not.toContain(secret);
  }
});
