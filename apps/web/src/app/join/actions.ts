"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { joinWithInvite } from "../../server/accounts";
import {
  accounts,
  events,
  inviteCodes,
  sessionReader,
} from "../../server/container";
import { type FormState, textField } from "../form";
import { startVisit } from "../visit";

// Q-P1-24, ADR-0016: the only way in during the private beta, an account made with an
// invite code. Better Auth's nextCookies plugin sets the session cookie on this
// action's response.
export async function join(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const requestHeaders = await headers();
  if ((await sessionReader().current(requestHeaders)) !== null) redirect("/");
  const result = await joinWithInvite(
    { codes: inviteCodes(), accounts: accounts() },
    {
      code: textField(form, "code"),
      name: textField(form, "name"),
      email: textField(form, "email"),
      password: textField(form, "password"),
    },
    requestHeaders,
  );
  if (!result.ok) return { message: result.message };
  const visit = await startVisit(result.actor);
  events().emit("signup_completed", {}, { ...result.actor, sessionId: visit });
  redirect("/onboarding");
}
