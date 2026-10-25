"use client";

import { useActionState } from "react";
import type { FormState } from "./form";

type Field = {
  name: string;
  label: string;
  type: "text" | "email" | "password" | "hidden";
  autoComplete?: string;
  defaultValue?: string;
};

// The sign-up, sign-in and password reset forms: fields, one button, and the message
// the server action returns.
export function AuthForm({
  action,
  fields,
  submit,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  fields: Field[];
  submit: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction}>
      {fields.map((field) =>
        field.type === "hidden" ? (
          <input
            key={field.name}
            type="hidden"
            name={field.name}
            value={field.defaultValue ?? ""}
          />
        ) : (
          <p key={field.name}>
            <label htmlFor={field.name}>{field.label}</label>
            <input
              id={field.name}
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              defaultValue={field.defaultValue}
              required
            />
          </p>
        ),
      )}
      <button type="submit" disabled={pending}>
        {submit}
      </button>
      {state === null ? null : <p role="alert">{state.message}</p>}
    </form>
  );
}
