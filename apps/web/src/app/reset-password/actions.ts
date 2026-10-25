"use server";

import { redirect } from "next/navigation";
import { resetPassword } from "../../server/accounts";
import { accounts } from "../../server/container";
import { type FormState, textField } from "../form";

export async function resetPasswordAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await resetPassword(
    accounts(),
    textField(form, "token"),
    textField(form, "password"),
  );
  if (!result.ok) return { message: result.message };
  redirect("/sign-in?reset=1");
}
