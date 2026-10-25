"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  guestSessions,
  inviteCodes,
  sessionReader,
} from "../../server/container";
import { startGuest } from "../../server/guest";

export type JoinState = { message: string } | null;

// Q-P1-24: the only way in during the private beta. Better Auth's nextCookies plugin
// sets the session cookie on this action's response.
export async function join(
  _previous: JoinState,
  form: FormData,
): Promise<JoinState> {
  const requestHeaders = await headers();
  if ((await sessionReader().current(requestHeaders)) !== null) redirect("/");
  const code = form.get("code");
  const result = await startGuest(
    { codes: inviteCodes(), guests: guestSessions() },
    typeof code === "string" ? code : "",
    requestHeaders,
  );
  if (!result.ok) return { message: result.message };
  redirect("/");
}
