import { expect, test, vi } from "vitest";
import { fetchGitHub } from "./fetch-github";

// P2-W12-S01 (§5H, ADR-0024): GitHub's OAuth exchange and the two reads, over fetch.
const app = { clientId: "Iv23liAbC", clientSecret: "s".repeat(40) };

function stub(answers: Record<string, { status?: number; body: unknown }>) {
  return vi.fn<typeof fetch>((input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const key = Object.keys(answers).find((k) => url.startsWith(k));
    const answer = key === undefined ? undefined : answers[key];
    if (answer === undefined) throw new Error(`unexpected ${url}`);
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

test("a callback's code is exchanged for the user's token with the App's credentials", async () => {
  const request = stub({
    "https://github.com/login/oauth/access_token": {
      body: { access_token: "ghu_abc", token_type: "bearer" },
    },
  });
  expect(await fetchGitHub(app, request).exchange("code-1")).toBe("ghu_abc");
  const [url, init] = request.mock.calls[0] ?? [];
  expect(url).toBe("https://github.com/login/oauth/access_token");
  expect(init?.method).toBe("POST");
  expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toEqual({
    client_id: "Iv23liAbC",
    client_secret: "s".repeat(40),
    code: "code-1",
  });
});

test("a refused or odd exchange throws, naming GitHub's reason, never the secret", async () => {
  const refused = stub({
    "https://github.com/login/oauth/access_token": {
      body: { error: "bad_verification_code" },
    },
  });
  const error = await fetchGitHub(app, refused)
    .exchange("old")
    .catch((e: unknown) => e);
  expect(String(error)).toMatch(/bad_verification_code/);
  expect(String(error)).not.toContain("s".repeat(40));
  const down = stub({
    "https://github.com/login/oauth/access_token": { status: 502, body: {} },
  });
  await expect(fetchGitHub(app, down).exchange("x")).rejects.toThrow(/502/);
});

test("the user and the App's installations they can reach", async () => {
  const request = stub({
    "https://api.github.com/user/installations": {
      body: {
        total_count: 2,
        installations: [
          { id: 11, account: { login: "octo", type: "User" }, extra: 1 },
          { id: 12, account: { login: "acme", type: "Organization" } },
          // An enterprise's has no login: skipped, not a failed connect.
          {
            id: 13,
            account: { slug: "bigco", name: "BigCo", type: "Enterprise" },
          },
        ],
      },
    },
    "https://api.github.com/user": { body: { id: 42, login: "octo" } },
  });
  const github = fetchGitHub(app, request);
  expect(await github.user("ghu_abc")).toEqual({ id: "42", login: "octo" });
  expect(await github.installations("ghu_abc")).toEqual([
    { installationId: "11", accountLogin: "octo", accountType: "User" },
    { installationId: "12", accountLogin: "acme", accountType: "Organization" },
  ]);
  const [, init] = request.mock.calls[0] ?? [];
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer ghu_abc",
  );
  const failing = stub({
    "https://api.github.com/user": {
      status: 401,
      body: { message: "Bad credentials" },
    },
  });
  await expect(fetchGitHub(app, failing).user("x")).rejects.toThrow(/401/);
});

test("an exchange with neither a token nor an error throws; the token is revoked with the App's credentials", async () => {
  const empty = stub({
    "https://github.com/login/oauth/access_token": { body: {} },
  });
  await expect(fetchGitHub(app, empty).exchange("x")).rejects.toThrow(
    /no token/,
  );
  const request = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  await fetchGitHub(app, request).revoke("ghu_abc");
  const [url, init] = request.mock.calls[0] ?? [];
  expect(url).toBe("https://api.github.com/applications/Iv23liAbC/token");
  expect(init?.method).toBe("DELETE");
  const headers = new Headers(init?.headers);
  expect(headers.get("authorization")).toBe(
    `Basic ${Buffer.from(`Iv23liAbC:${"s".repeat(40)}`).toString("base64")}`,
  );
  expect(headers.get("x-github-api-version")).toBe("2022-11-28");
  expect(JSON.parse(typeof init?.body === "string" ? init.body : "")).toEqual({
    access_token: "ghu_abc",
  });
  const refused = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, { status: 422 })),
  );
  await expect(fetchGitHub(app, refused).revoke("x")).rejects.toThrow(/422/);
});

test("an installation's repositories this user can reach, page by page", async () => {
  const request = vi.fn<typeof fetch>((input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const page = url.searchParams.get("page") ?? "1";
    return Promise.resolve(
      new Response(
        JSON.stringify({
          repositories: page === "1" ? [{ id: 21 }, { id: 22 }] : [{ id: 23 }],
        }),
        {
          headers:
            page === "1"
              ? {
                  link: `<${url.origin}${url.pathname}?per_page=100&page=2>; rel="next"`,
                }
              : {},
        },
      ),
    );
  });
  expect(
    await fetchGitHub(app, request).reachableRepositories("ghu_abc", "12"),
  ).toEqual(["21", "22", "23"]);
  const [first] = request.mock.calls[0] ?? [];
  expect(first).toBe(
    "https://api.github.com/user/installations/12/repositories?per_page=100",
  );
});
