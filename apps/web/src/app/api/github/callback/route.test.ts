import { afterEach, expect, test, vi } from "vitest";
import type { Actor, GitHub, GitHubAccounts } from "../../../../server/ports";

// P2-W12-S01 (§5H, ADR-0024): the callback proves who installed the App and where, by
// GitHub's own answer, never by its query.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const exchange = vi.fn<GitHub["exchange"]>();
const githubUser = vi.fn<GitHub["user"]>();
const installations = vi.fn<GitHub["installations"]>();
const revoke = vi.fn<GitHub["revoke"]>(() => Promise.resolve());
const reachableRepositories = vi.fn<GitHub["reachableRepositories"]>(() =>
  Promise.resolve(["21"]),
);
const enqueue = vi.fn<(...args: unknown[]) => Promise<void>>(() =>
  Promise.resolve(),
);
const connect = vi.fn<GitHubAccounts["connect"]>(() => Promise.resolve());
const emit = vi.fn();
const warn = vi.fn();
let configured = true;
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  githubApp: () =>
    configured
      ? {
          slug: "interval-dev",
          clientId: "Iv23liAbC",
          secureCookies: false,
          github: {
            exchange,
            user: githubUser,
            installations,
            revoke,
            reachableRepositories,
          },
        }
      : null,
  githubAccounts: () => ({ connect }),
  jobQueue: () => ({ enqueue }),
  events: () => ({ emit }),
}));
vi.mock("../../../../server/log", () => ({ log: { warn } }));
let nonceCookie: string | null = null;
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit"
          ? { name, value: "visit-1.1790000000" }
          : name === "iv_github" && nonceCookie !== null
            ? { name, value: nonceCookie }
            : undefined,
    }),
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const NONCE = "n".repeat(24);
const mine = {
  installationId: "11",
  accountLogin: "octo",
  accountType: "User" as const,
};

afterEach(() => {
  vi.clearAllMocks();
  configured = true;
});

async function callback(
  query: string,
  nonce: string | null = NONCE,
): Promise<Response> {
  const { GET } = await import("./route");
  nonceCookie = nonce;
  return GET(new Request(`http://localhost:3100/api/github/callback?${query}`));
}

test("the user's installations come from GitHub's answer; the query's installation_id is ignored", async () => {
  current.mockResolvedValue(user);
  exchange.mockResolvedValue("ghu_abc");
  githubUser.mockResolvedValue({ id: "42", login: "octo" });
  installations.mockResolvedValue([mine]);
  const response = await callback(
    `code=c1&state=${NONCE}&installation_id=999&setup_action=install`,
  );
  expect(exchange).toHaveBeenCalledWith("c1");
  expect(installations).toHaveBeenCalledWith("ghu_abc");
  expect(connect).toHaveBeenCalledWith(
    "u1",
    { githubUserId: "42", login: "octo" },
    [mine],
    {},
  );
  expect(response.headers.get("location")).toBe("/profile?saved=github");
  // The nonce is spent.
  expect(response.headers.get("set-cookie")).toMatch(/iv_github=;.*Max-Age=0/i);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith(
    "github_connected",
    { installations: 1 },
    expect.objectContaining({ userId: "u1", sessionId: "visit-1" }),
  );
  // Read and done: the token is revoked.
  expect(revoke).toHaveBeenCalledWith("ghu_abc");
});

test("no nonce, a wrong one, no code, or GitHub refusing: nothing stored", async () => {
  current.mockResolvedValue(user);
  exchange.mockResolvedValue("ghu_abc");
  githubUser.mockResolvedValue({ id: "42", login: "octo" });
  installations.mockResolvedValue([mine]);
  for (const response of [
    await callback(`code=c1&state=${NONCE}`, null),
    await callback("code=c1&state=other"),
    await callback(`state=${NONCE}`),
  ])
    expect(response.headers.get("location")).toBe("/profile?github=failed");
  expect(exchange).not.toHaveBeenCalled();
  exchange.mockRejectedValueOnce(new Error("github: code not exchanged (bad)"));
  expect(
    (await callback(`code=c1&state=${NONCE}`)).headers.get("location"),
  ).toBe("/profile?github=failed");
  expect(warn).toHaveBeenCalledWith(
    "github: connect failed",
    expect.objectContaining({ error: expect.anything() as unknown }),
  );
  expect(connect).not.toHaveBeenCalled();
  // Nothing reachable (uninstalled everywhere): stored as none, so nothing stale stays.
  installations.mockResolvedValueOnce([]);
  expect(
    (await callback(`code=c1&state=${NONCE}`)).headers.get("location"),
  ).toBe("/profile?github=none");
  expect(connect).toHaveBeenCalledWith(
    "u1",
    { githubUserId: "42", login: "octo" },
    [],
    {},
  );
  expect(emit).not.toHaveBeenCalled();
});

test("signed out goes to join, a guest to Profile, and not configured is not found", async () => {
  current.mockResolvedValue(null);
  expect((await callback("code=c1")).headers.get("location")).toBe("/join");
  current.mockResolvedValue({ ...user, isGuest: true });
  expect((await callback("code=c1")).headers.get("location")).toBe("/profile");
  current.mockResolvedValue(user);
  configured = false;
  expect((await callback("code=c1")).status).toBe(404);
  expect(exchange).not.toHaveBeenCalled();
});

test("an install whose redirect dropped the state goes through authorize with a fresh nonce", async () => {
  current.mockResolvedValue(user);
  const response = await callback(
    "code=c1&installation_id=11&setup_action=install",
  );
  // The planted-cookie case: no code is exchanged without a matching state.
  expect(exchange).not.toHaveBeenCalled();
  const target = new URL(response.headers.get("location") ?? "");
  expect(target.origin + target.pathname).toBe(
    "https://github.com/login/oauth/authorize",
  );
  const fresh = target.searchParams.get("state") ?? "";
  expect(fresh).not.toBe(NONCE);
  expect(response.headers.get("set-cookie")).toContain(`iv_github=${fresh}`);
  // Without any nonce: refused outright.
  expect((await callback("code=c1", null)).headers.get("location")).toBe(
    "/profile?github=failed",
  );
});

test("repositories changed on GitHub (no code) just go back to Profile", async () => {
  current.mockResolvedValue(user);
  expect(
    (await callback("setup_action=update&installation_id=11")).headers.get(
      "location",
    ),
  ).toBe("/profile");
  expect(exchange).not.toHaveBeenCalled();
});

// P2-W12-S02: an organisation's reachable repositories, read before the revoke; the
// first read queued.
test("an organisation's reachable repositories are read with the user's token, then the read is queued", async () => {
  current.mockResolvedValue(user);
  exchange.mockResolvedValue("ghu_abc");
  githubUser.mockResolvedValue({ id: "42", login: "octo" });
  const org = {
    installationId: "12",
    accountLogin: "acme",
    accountType: "Organization" as const,
  };
  installations.mockResolvedValue([mine, org]);
  await callback(`code=c1&state=${NONCE}`);
  expect(reachableRepositories).toHaveBeenCalledWith("ghu_abc", "12");
  expect(reachableRepositories).toHaveBeenCalledTimes(1); // not for the user's own
  expect(connect).toHaveBeenCalledWith(
    "u1",
    { githubUserId: "42", login: "octo" },
    [mine, org],
    { "12": ["21"] },
  );
  expect(revoke.mock.invocationCallOrder[0] ?? 0).toBeGreaterThan(
    reachableRepositories.mock.invocationCallOrder[0] ?? 0,
  );
  expect(enqueue).toHaveBeenCalledWith(
    "github_sync",
    { user_id: "u1" },
    {
      idempotencyKey: expect.stringMatching(/^github-sync-u1-\d+$/) as unknown,
    },
  );
});

test("someone else's personal account they collaborate on is filtered too; their own isn't", async () => {
  current.mockResolvedValue(user);
  exchange.mockResolvedValue("ghu_abc");
  githubUser.mockResolvedValue({ id: "42", login: "Octo" });
  const friend = {
    installationId: "13",
    accountLogin: "friend",
    accountType: "User" as const,
  };
  installations.mockResolvedValue([mine, friend]);
  await callback(`code=c1&state=${NONCE}`);
  expect(reachableRepositories).toHaveBeenCalledTimes(1);
  expect(reachableRepositories).toHaveBeenCalledWith("ghu_abc", "13");
});
