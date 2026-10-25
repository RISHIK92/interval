"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signUp } from "../../server/accounts";
import { accounts } from "../../server/container";
import { type FormState, textField } from "../form";

export async function signUpAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await signUp(accounts(), await headers(), {
    name: textField(form, "name"),
    email: textField(form, "email"),
    password: textField(form, "password"),
  });
  if (!result.ok) return { message: result.message };
  redirect("/");
}
