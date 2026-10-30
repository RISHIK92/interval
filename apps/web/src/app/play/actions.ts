"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  guestSessions,
  inviteCodes,
  sessionReader,
} from "../../server/container";
import { startGuest } from "../../server/guest";
import { type FormState, textField } from "../form";
import { startVisit } from "../visit";

// ADR-0029, Q-P1-24: a guest for Play, made with an invite code; one per browser, so a
// visitor who already has a session just plays. Better Auth's nextCookies plugin sets
// the session cookie on this action's response.
export async function startGuestAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const requestHeaders = await headers();
  if ((await sessionReader().current(requestHeaders)) !== null)
    redirect("/play");
  const result = await startGuest(
    { codes: inviteCodes(), guests: guestSessions() },
    textField(form, "code"),
    requestHeaders,
  );
  if (!result.ok) return { message: result.message };
  await startVisit(result.actor);
  redirect("/play");
}
