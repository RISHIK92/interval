import { z } from "zod";
import { log } from "../log";
import type { GitHub } from "../ports";

// P2-W12-S01 (§5H, ADR-0024): GitHub's OAuth code exchange for the App, and the two
// reads that prove who installed it and where. Plain fetch, answers checked at the
// boundary; the user's token is used for these calls and then dropped.
const API = "https://api.github.com";
const TIMEOUT_MS = 10_000;

const Exchanged = z.object({
  access_token: z.string().min(1).optional(),
  error: z.string().optional(),
});
const User = z.object({ id: z.number().int(), login: z.string().min(1) });
// An enterprise's installation has no login: it's skipped, not a reason to fail.
const Repositories = z.object({
  repositories: z.array(z.object({ id: z.number().int() })),
});
// GitHub pages with a Link header; the next page's URL, if any.
const nextPage = (response: Response): string | null =>
  /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1] ??
  null;
const MAX_PAGES = 10; // shortcut: 1,000 repositories per installation; page on past it

const Installations = z.object({
  installations: z.array(
    z.object({
      id: z.number().int(),
      account: z.object({ login: z.string().optional(), type: z.string() }),
    }),
  ),
});

export function fetchGitHub(
  app: { clientId: string; clientSecret: string },
  request: typeof fetch = fetch,
): GitHub {
  const fetchPage = async (token: string, url: string): Promise<Response> => {
    const response = await request(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok)
      throw new Error(
        `github: ${new URL(url).pathname} answered ${String(response.status)}`,
      );
    return response;
  };
  const read = async (token: string, path: string): Promise<unknown> =>
    (await fetchPage(token, `${API}${path}`)).json();
  return {
    exchange: async (code) => {
      const response = await request(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            client_id: app.clientId,
            client_secret: app.clientSecret,
            code,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok)
        throw new Error(
          `github: code exchange answered ${String(response.status)}`,
        );
      // GitHub answers a refused code with 200 and an error field.
      const body = Exchanged.parse(await response.json());
      if (body.access_token === undefined)
        throw new Error(
          `github: code not exchanged (${body.error ?? "no token"})`,
        );
      return body.access_token;
    },
    user: async (token) => {
      const user = User.parse(await read(token, "/user"));
      return { id: String(user.id), login: user.login };
    },
    installations: async (token) =>
      // shortcut: the first 100 installations a user can reach; page on when someone
      // has more.
      Installations.parse(
        await read(token, "/user/installations?per_page=100"),
      ).installations.flatMap(({ id, account }) =>
        account.login !== undefined &&
        (account.type === "User" || account.type === "Organization")
          ? [
              {
                installationId: String(id),
                accountLogin: account.login,
                accountType: account.type,
              },
            ]
          : [],
      ),
    reachableRepositories: async (token, installationId) => {
      const ids: string[] = [];
      let url: string | null =
        `${API}/user/installations/${installationId}/repositories?per_page=100`;
      for (let page = 0; url !== null && page < MAX_PAGES; page++) {
        const response = await fetchPage(token, url);
        const body = Repositories.parse(await response.json());
        ids.push(...body.repositories.map((r) => String(r.id)));
        url = nextPage(response);
      }
      if (url !== null)
        log.warn("github: reachable repositories capped", {
          installationId,
          kept: ids.length,
        });
      return ids;
    },
    revoke: async (token) => {
      const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString(
        "base64",
      );
      const response = await request(
        `${API}/applications/${app.clientId}/token`,
        {
          method: "DELETE",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Basic ${basic}`,
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify({ access_token: token }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok)
        throw new Error(
          `github: token revoke answered ${String(response.status)}`,
        );
    },
  };
}
