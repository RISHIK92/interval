"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "../../server/accounts";
import { accounts } from "../../server/container";
import { type FormState, textField } from "../form";

export async function signInAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await signIn(accounts(), await headers(), {
    email: textField(form, "email"),
    password: textField(form, "password"),
  });
  if (!result.ok) return { message: result.message };
  redirect("/");
}
