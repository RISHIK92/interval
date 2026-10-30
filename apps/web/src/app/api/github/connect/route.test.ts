import { afterEach, expect, test, vi } from "vitest";
import type { Actor } from "../../../../server/ports";

// P2-W12-S01 (§5H, ADR-0024): connecting GitHub starts at the App's install page, with
// a nonce the callback checks.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const githubApp = vi.fn();
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  githubApp: () => githubApp() as unknown,
}));

const user: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const app = {
  slug: "interval-dev",
  clientId: "Iv23liAbC",
  secureCookies: false,
};

afterEach(() => {
  vi.clearAllMocks();
});

async function connect(query = ""): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost:3100/api/github/connect${query}`));
}

test("an account goes to the App's install page with a nonce, kept in a short cookie", async () => {
  current.mockResolvedValue(user);
  githubApp.mockReturnValue(app);
  const response = await connect();
  expect(response.status).toBe(303);
  const target = new URL(response.headers.get("location") ?? "");
  expect(target.origin + target.pathname).toBe(
    "https://github.com/apps/interval-dev/installations/new",
  );
  const state = target.searchParams.get("state") ?? "";
  expect(state).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(`iv_github=${state}`);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).toMatch(/Max-Age=600/);
});

test("linking an App installed before goes through GitHub's authorize page", async () => {
  current.mockResolvedValue(user);
  githubApp.mockReturnValue(app);
  const target = new URL(
    (await connect("?link=1")).headers.get("location") ?? "",
  );
  expect(target.origin + target.pathname).toBe(
    "https://github.com/login/oauth/authorize",
  );
  expect(target.searchParams.get("client_id")).toBe("Iv23liAbC");
  expect(target.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
});

test("signed out goes to join; a guest to sign up (ADR-0029); not configured is not found", async () => {
  githubApp.mockReturnValue(app);
  current.mockResolvedValue(null);
  expect((await connect()).headers.get("location")).toBe("/join");
  current.mockResolvedValue({ ...user, isGuest: true });
  expect((await connect()).headers.get("location")).toBe("/sign-up");
  current.mockResolvedValue(user);
  githubApp.mockReturnValue(null);
  expect((await connect()).status).toBe(404);
});
