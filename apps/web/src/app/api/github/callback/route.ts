import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  events,
  githubAccounts,
  githubApp,
  jobQueue,
  sessionReader,
} from "../../../../server/container";
import { log } from "../../../../server/log";
import type { Actor, GitHub } from "../../../../server/ports";
import { visitId } from "../../../../server/visits";
import { NONCE_COOKIE, nonceCookie } from "../nonce";

export const dynamic = "force-dynamic";

// P2-W12-S01 (§5H, ADR-0024): GitHub sends the user back here after installing the App
// (or authorizing it). Its installation_id can be forged (GitHub's docs), so it's
// ignored: the code is exchanged for the user's token, and the installations stored
// are the ones GitHub says that user can reach. The token is then revoked.
export async function GET(request: Request): Promise<Response> {
  const app = githubApp();
  if (app === null) return new Response(null, { status: 404 });
  const actor = await sessionReader().current(request.headers);
  if (actor === null) return see("/join");
  // ADR-0029: guests play, and only play.
  if (actor.isGuest) return see("/sign-up");
  const query = new URL(request.url).searchParams;
  const code = query.get("code");
  const state = query.get("state");
  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value ?? null;
  // Repositories changed under the App's settings on GitHub: nothing to prove here.
  if (code === null && query.get("setup_action") === "update")
    return see("/profile");
  // Only a state that matches this browser's nonce counts: the cookie alone can be
  // planted (a cross-site visit to /connect). An install whose redirect dropped the
  // state is sent through GitHub's authorize page, which carries a fresh one back.
  if (code !== null && state === null && nonce !== null) {
    const fresh = randomBytes(24).toString("base64url");
    const again = new NextResponse(null, {
      status: 303,
      headers: {
        Location: `https://github.com/login/oauth/authorize?${new URLSearchParams(
          { client_id: app.clientId, state: fresh },
        ).toString()}`,
      },
    });
    again.cookies.set(NONCE_COOKIE, fresh, nonceCookie(app.secureCookies));
    return again;
  }
  const begunHere = nonce !== null && state !== null && sameText(state, nonce);
  let outcome: "saved=github" | "github=failed" | "github=none";
  if (code === null || !begunHere) outcome = "github=failed";
  else {
    try {
      outcome = await connect(app.github, actor, code);
    } catch (error) {
      log.warn("github: connect failed", { error });
      outcome = "github=failed";
    }
  }
  // Relative: behind the load balancer request.url isn't the public origin.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: `/profile?${outcome}` },
  });
  // Spent either way.
  response.cookies.set(NONCE_COOKIE, "", {
    ...nonceCookie(app.secureCookies),
    maxAge: 0,
  });
  return response;
}

async function connect(
  github: GitHub,
  actor: Actor,
  code: string,
): Promise<"saved=github" | "github=none"> {
  const token = await github.exchange(code);
  try {
    const [who, reachable] = await Promise.all([
      github.user(token),
      github.installations(token),
    ]);
    // S02: on any account but their own (an organisation's, or one they collaborate
    // on) the App reads more than this user may see; what they can reach is read
    // now, while their token is in hand.
    const reachableRepos: Record<string, string[]> = {};
    for (const installation of reachable)
      if (installation.accountLogin.toLowerCase() !== who.login.toLowerCase())
        reachableRepos[installation.installationId] =
          await github.reachableRepositories(
            token,
            installation.installationId,
          );
    // Stored even when empty: installations GitHub no longer shows them are gone.
    await githubAccounts().connect(
      actor.userId,
      { githubUserId: who.id, login: who.login },
      reachable,
      reachableRepos,
    );
    if (reachable.length > 0)
      await queueSync(
        actor.userId,
        `github-sync-${actor.userId}-${String(Date.now())}`,
      );
    if (reachable.length === 0) return "github=none";
    events().emit(
      "github_connected",
      { installations: reachable.length },
      { ...actor, sessionId: visitId(await cookies()) },
    );
    return "saved=github";
  } finally {
    // Read and done: the token is revoked, not kept (ADR-0024).
    await github.revoke(token).catch((error: unknown) => {
      log.warn("github: token not revoked", { error });
    });
  }
}

// S02: the worker reads the repositories (LOAD-5: a queue that's down is logged; the
// daily read and Refresh catch up).
async function queueSync(userId: string, key: string): Promise<void> {
  try {
    await jobQueue().enqueue(
      "github_sync",
      { user_id: userId },
      { idempotencyKey: key },
    );
  } catch (error) {
    log.error("github: sync not queued", { userId, error });
  }
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function see(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
