"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "../../server/accounts";
import { accounts } from "../../server/container";
import { type FormState, textField } from "../form";
import { startVisit } from "../visit";

export async function signInAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await signIn(accounts(), await headers(), {
    email: textField(form, "email"),
    password: textField(form, "password"),
  });
  if (!result.ok) return { message: result.message };
  // A new user on this browser, even a guest signing in: a new visit.
  await startVisit(result.actor);
  redirect("/");
}
