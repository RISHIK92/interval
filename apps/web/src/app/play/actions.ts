"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "../../env";
import { clientIp } from "../../server/clientIp";
import {
  guestLimits,
  guestSessions,
  sessionReader,
} from "../../server/container";
import { startGuest } from "../../server/guest";
import { PLAYER_COOKIE } from "../../server/visits";
import type { FormState } from "../form";
import { startVisit } from "../visit";

// ADR-0029, ADR-0056: a guest for Play, no invite code needed; one per browser, so a
// visitor who already has a session just plays. Better Auth's nextCookies plugin sets
// the session cookie on this action's response.
export async function startGuestAction(): Promise<FormState> {
  const requestHeaders = await headers();
  if ((await sessionReader().current(requestHeaders)) !== null)
    redirect("/play");
  // P3-W13-S07: a browser that already had a player (a guest, or an account signed in
  // here) makes no new guest; clearing cookies gets past this, the network limit not.
  if ((await cookies()).get(PLAYER_COOKIE) !== undefined)
    return { message: "This browser already had a player. Sign in instead." };
  const result = await startGuest(
    { guests: guestSessions(), limits: guestLimits() },
    requestHeaders,
    clientIp(requestHeaders, env().TRUSTED_PROXIES),
  );
  if (!result.ok) return { message: result.message };
  await startVisit(result.actor);
  redirect("/play");
}
