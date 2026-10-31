"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { quickReset, requestReset } from "../../server/accounts";
import { accounts } from "../../server/container";
import { isLocalRequest } from "../../server/local-request";
import { type FormState, textField } from "../form";

// The same answer whether or not the account exists.
const SENT = "If an account exists for that email, we've sent a reset link.";

// ADR-0030: on this machine an email and a new password reset it outright; from
// anywhere else (ngrok included) only a link is sent. Checked here again because an
// action is reachable without its page.
export async function forgotPasswordAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  if (isLocalRequest(await headers())) {
    const result = await quickReset(
      accounts(),
      textField(form, "email"),
      textField(form, "password"),
    );
    if (!result.ok) return { message: result.message };
    redirect("/sign-in?reset=1");
  }
  await requestReset(accounts(), textField(form, "email"));
  return { message: SENT };
}
