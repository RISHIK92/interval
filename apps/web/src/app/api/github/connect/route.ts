import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { githubApp, sessionReader } from "../../../../server/container";
import { NONCE_COOKIE, nonceCookie } from "../nonce";

export const dynamic = "force-dynamic";

// P2-W12-S01 (§5H, ADR-0024): connecting GitHub starts at the App's install page, where
// the user picks the repositories; ?link=1 starts at GitHub's authorize page instead,
// for an App installed before. Accounts only (owner: GitHub is a data connection).
export async function GET(request: Request): Promise<Response> {
  const app = githubApp();
  if (app === null) return new Response(null, { status: 404 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return see("/join");
  // ADR-0029: guests play, and only play.
  if (actor.isGuest) return see("/sign-up");
  const nonce = randomBytes(24).toString("base64url");
  const target =
    new URL(request.url).searchParams.get("link") === "1"
      ? `https://github.com/login/oauth/authorize?${new URLSearchParams({
          client_id: app.clientId,
          state: nonce,
        }).toString()}`
      : `https://github.com/apps/${app.slug}/installations/new?state=${nonce}`;
  const response = NextResponse.redirect(target, 303);
  response.cookies.set(NONCE_COOKIE, nonce, nonceCookie(app.secureCookies));
  return response;
}

function see(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
