"use server";

import { requestReset } from "../../server/accounts";
import { accounts } from "../../server/container";
import { type FormState, textField } from "../form";

// The same answer whether or not the account exists.
const SENT = "If an account exists for that email, we've sent a reset link.";

export async function forgotPasswordAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  await requestReset(accounts(), textField(form, "email"));
  return { message: SENT };
}
