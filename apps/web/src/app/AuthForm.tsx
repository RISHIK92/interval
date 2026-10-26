"use client";

import { useActionState } from "react";
import type { FormState } from "./form";
import { Button } from "./ui/Button";
import { FIELD } from "./ui/field";

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
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      {fields.map((field) =>
        field.type === "hidden" ? (
          <input
            key={field.name}
            type="hidden"
            name={field.name}
            value={field.defaultValue ?? ""}
          />
        ) : (
          <label key={field.name} className="text-section">
            {field.label}
            <input
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              defaultValue={field.defaultValue}
              required
              className={FIELD}
            />
          </label>
        ),
      )}
      <Button type="submit" disabled={pending}>
        {submit}
      </Button>
      {state === null ? null : (
        <p role="alert" className="text-wrong">
          {state.message}
        </p>
      )}
    </form>
  );
}
