import {
  DeleteQueryNode,
  InsertQueryNode,
  sql,
  TableNode,
  type KyselyPlugin,
  type OperationNode,
} from "kysely";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { GuestNotRemoved } from "../ports";
import { createAuth, guestSessions, sessionReader } from "./better-auth";
import { createDb } from "./kysely";

// Real Better Auth against the local database. Rows are committed (Better Auth owns its
// own connections), so everything created here is tagged and removed afterwards.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);
const SECRET = "test-secret-test-secret-test-secret-0123";
const BASE_URL = "http://localhost:3100";
const mailer = { send: () => Promise.resolve() };
const auth = createAuth({ db, secret: SECRET, baseURL: BASE_URL, mailer });
const guests = guestSessions(auth);
const sessions = sessionReader(auth);
const PREFIX = "TESTAUTH";
let codeId = "";

async function cleanup(): Promise<void> {
  const codes = db
    .selectFrom("invite_code")
    .select("id")
    .where("code", "like", `${PREFIX}%`);
  await db
    .deleteFrom("app_user")
    .where("invite_code_id", "in", codes)
    .execute();
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
      beta_group: "student",
      max_uses: 100,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  codeId = row.id;
});

afterAll(async () => {
  await cleanup();
  await db.destroy();
});

function cookieHeader(setCookies: string[]): Headers {
  const pairs = setCookies.map((c) => c.split(";")[0] ?? "");
  return new Headers({ cookie: pairs.join("; ") });
}

async function newGuest(): Promise<{ headers: Headers; userId: string }> {
  const started = await guests.start(
    { ok: true, inviteCodeId: codeId, betaGroup: "student" },
    new Headers(),
  );
  const headers = cookieHeader(started.setCookies);
  const actor = await sessions.current(headers);
  if (actor === null) throw new Error("no session after start");
  // start() reports the guest it made, so callers need no second lookup.
  expect(started.actor).toEqual(actor);
  return { headers, userId: actor.userId };
}

test("a guest is created in the code's group, anonymous, and the cookie resolves to it", async () => {
  const { headers, userId } = await newGuest();
  const user = await db
    .selectFrom("app_user")
    .select(["beta_group", "invite_code_id", "is_anonymous"])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  expect(user).toEqual({
    beta_group: "student",
    invite_code_id: codeId,
    is_anonymous: true,
  });
  expect(await sessions.current(headers)).toEqual({
    userId,
    isGuest: true,
    betaGroup: "student",
  });
});

async function usersOnCode(): Promise<number> {
  const rows = await db
    .selectFrom("app_user")
    .select("id")
    .where("invite_code_id", "=", codeId)
    .execute();
  return rows.length;
}

// The refusal is the evidence: Better Auth answers FAILED_TO_CREATE_USER only when its
// create was refused. (Counting every user before and after raced the other test files
// that share the database, and failed CI.)
test("Better Auth cannot create a user outside the invite flow", async () => {
  await expect(
    auth.api.signInAnonymous({ headers: new Headers() }),
  ).rejects.toMatchObject({ body: { code: "FAILED_TO_CREATE_USER" } });
});

function tableOf(node: OperationNode): string | undefined {
  if (InsertQueryNode.is(node)) return node.into?.table.identifier.name;
  if (!DeleteQueryNode.is(node)) return undefined;
  const from = node.from.froms[0];
  return from !== undefined && TableNode.is(from)
    ? from.table.identifier.name
    : undefined;
}

// Fails the chosen writes, to reach the step after Better Auth has committed the user.
function failing(writes: { kind: "insert" | "delete"; table: string }[]) {
  const plugin: KyselyPlugin = {
    transformQuery: ({ node }) => {
      const kind = InsertQueryNode.is(node)
        ? "insert"
        : DeleteQueryNode.is(node)
          ? "delete"
          : undefined;
      const table = tableOf(node);
      if (writes.some((w) => w.kind === kind && w.table === table)) {
        throw new Error(`test: ${String(kind)} into ${String(table)} refused`);
      }
      return node;
    },
    transformResult: ({ result }) => Promise.resolve(result),
  };
  return guestSessions(
    createAuth({
      db: db.withPlugin(plugin),
      secret: SECRET,
      baseURL: BASE_URL,
      mailer,
    }),
  );
}

const redemption = {
  ok: true,
  inviteCodeId: "",
  betaGroup: "student",
} as const;

test("when the session cannot be created, the half-made guest is removed", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const guestsFailingSession = failing([
    { kind: "insert", table: "auth_session" },
  ]);
  const before = await usersOnCode();
  await expect(
    guestsFailingSession.start(
      { ...redemption, inviteCodeId: codeId },
      new Headers(),
    ),
  ).rejects.not.toBeInstanceOf(GuestNotRemoved);
  expect(await usersOnCode()).toBe(before);
  vi.restoreAllMocks();
});

test("if the half-made guest cannot be removed either, start says so", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const guestsFailingBoth = failing([
    { kind: "insert", table: "auth_session" },
    { kind: "delete", table: "app_user" },
  ]);
  const before = await usersOnCode();
  await expect(
    guestsFailingBoth.start(
      { ...redemption, inviteCodeId: codeId },
      new Headers(),
    ),
  ).rejects.toBeInstanceOf(GuestNotRemoved);
  // Left for cleanup(); the use stays spent, so the code's count stays exact.
  expect(await usersOnCode()).toBe(before + 1);
  vi.restoreAllMocks();
});

test("a tampered or missing cookie resolves to no actor", async () => {
  const { headers } = await newGuest();
  const cookie = headers.get("cookie") ?? "";
  const tampered = new Headers({
    cookie: cookie.replace(
      /=(.)/,
      (_m, c: string) => `=${c === "a" ? "b" : "a"}`,
    ),
  });
  expect(await sessions.current(tampered)).toBeNull();
  expect(await sessions.current(new Headers())).toBeNull();
});

test("sessions last 30 days and slide forward once older than a day", async () => {
  const { headers, userId } = await newGuest();
  const days = async (): Promise<number> => {
    const row = await db
      .selectFrom("auth_session")
      .select(
        sql<string>`extract(epoch from expires_at - now()) / 86400`.as("days"),
      )
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow();
    return Number(row.days);
  };
  expect(await days()).toBeGreaterThan(29.9);
  // Age the session by two days, then use it: it is pushed back to 30 days.
  await db
    .updateTable("auth_session")
    .set({ expires_at: sql<Date>`now() + interval '28 days'` })
    .where("user_id", "=", userId)
    .execute();
  expect(await days()).toBeLessThan(28.1);
  await sessions.current(headers);
  expect(await days()).toBeGreaterThan(29.9);
});

// P4-W19-S03 (Q-P4-02): the native app signs in with the same accounts; Better Auth's
// Expo plugin carries its origin (interval://), which the origin check trusts. No other
// origin gets through, and the app can't make accounts either (ADR-0016).
const fromApp = (path: string, origin: string, body: object) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "expo-origin": origin,
        cookie: "x=1", // a cookie makes Better Auth check the origin
      },
      body: JSON.stringify(body),
    }),
  );

test("the app's origin passes the origin check; another is refused", async () => {
  const wrong = { email: "nobody@example.test", password: "not-the-password" };
  expect((await fromApp("sign-in/email", "interval://", wrong)).status).toBe(
    401,
  );
  expect(
    (await fromApp("sign-in/email", "https://evil.example", wrong)).status,
  ).toBe(403);
  // The web's own origin is unaffected.
  const fromWeb = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        cookie: "x=1",
      },
      body: JSON.stringify(wrong),
    }),
  );
  expect(fromWeb.status).toBe(401);
});

test("the app can't make an account", async () => {
  const email = `${PREFIX.toLowerCase()}-app@example.test`;
  const response = await fromApp("sign-up/email", "interval://", {
    email,
    password: "a-long-password",
    name: "App",
  });
  // Refused at the origin check: the app's scheme isn't trusted for sign-up (and
  // sign-up is off for every origin, ADR-0016).
  expect(response.status).toBe(403);
  // That account, not a count of all (other test files add users meanwhile).
  expect(
    await db
      .selectFrom("app_user")
      .select("id")
      .where("email", "=", email)
      .executeTakeFirst(),
  ).toBeUndefined();
});

// The app's scheme is trusted only where the app needs it: any app can claim a custom
// scheme, so a reset link must never be sent on to interval://.
test("a password reset can't redirect to the app's scheme", async () => {
  const response = await fromApp("request-password-reset", "interval://", {
    email: "nobody@example.test",
    redirectTo: "interval://reset",
  });
  expect(response.status).toBe(403);
});

// The Expo plugin's OAuth proxy redirects anywhere; there is no social sign-in to proxy.
test("the Expo plugin's authorization proxy is off", async () => {
  const response = await auth.handler(
    new Request(
      `${BASE_URL}/api/auth/expo-authorization-proxy?authorizationURL=${encodeURIComponent("https://evil.example/")}`,
    ),
  );
  expect(response.status).toBe(404);
});
