"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { mailVerificationOnSignUp, signUp } from "../../server/accounts";
import { accounts, events, sessionReader } from "../../server/container";
import { visitId } from "../../server/visits";
import { type FormState, textField } from "../form";

export async function signUpAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const requestHeaders = await headers();
  // Read before the upgrade: the guest's row becomes the account (same user id).
  const guest = await sessionReader().current(requestHeaders);
  const result = await signUp(accounts(), requestHeaders, {
    name: textField(form, "name"),
    email: textField(form, "email"),
    password: textField(form, "password"),
  });
  if (!result.ok) return { message: result.message };
  if (guest !== null) {
    const context = {
      ...guest,
      isGuest: false,
      sessionId: visitId(await cookies()),
    };
    events().emit("signup_completed", {}, context);
    // Q-P7-05: the verification mail goes after the response; sign-up never waits.
    after(() =>
      mailVerificationOnSignUp(
        { accounts: accounts(), events: events() },
        result.email,
        context,
      ),
    );
  }
  redirect("/");
}
