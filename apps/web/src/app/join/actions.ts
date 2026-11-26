"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "../../env";
import { createAccount } from "../../server/accounts";
import { clientIp } from "../../server/clientIp";
import {
  accounts,
  events,
  inviteCodes,
  rateLimits,
  sessionReader,
} from "../../server/container";
import { type FormState, textField } from "../form";
import { startVisit } from "../visit";

// ADR-0016, ADR-0056: the way in, an account open to anyone; an invite code from an old
// /join?code= link only sets a group. Better Auth's nextCookies plugin sets the session
// cookie on this action's response.
export async function join(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const requestHeaders = await headers();
  if ((await sessionReader().current(requestHeaders)) !== null) redirect("/");
  const result = await createAccount(
    { codes: inviteCodes(), accounts: accounts(), limits: rateLimits() },
    {
      code: textField(form, "code"),
      name: textField(form, "name"),
      email: textField(form, "email"),
      password: textField(form, "password"),
    },
    requestHeaders,
    clientIp(requestHeaders, env().TRUSTED_PROXIES),
  );
  if (!result.ok) return { message: result.message };
  const visit = await startVisit(result.actor);
  events().emit("signup_completed", {}, { ...result.actor, sessionId: visit });
  redirect("/onboarding");
}
