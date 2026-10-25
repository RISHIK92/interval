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

// Q-P1-24: the only way in during the private beta. Better Auth's nextCookies plugin
// sets the session cookie on this action's response.
export async function join(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const requestHeaders = await headers();
  if ((await sessionReader().current(requestHeaders)) !== null) redirect("/");
  const result = await startGuest(
    { codes: inviteCodes(), guests: guestSessions() },
    textField(form, "code"),
    requestHeaders,
  );
  if (!result.ok) return { message: result.message };
  redirect("/");
}
