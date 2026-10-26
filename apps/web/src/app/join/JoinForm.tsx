"use client";

import { useActionState } from "react";
import type { FormState } from "../form";
import { Button } from "../ui/Button";
import { join } from "./actions";

const FIELD =
  "mt-1 w-full rounded-xl border border-hairline bg-page px-3 py-2.5";

// Account first (ADR-0016): the invite code and the account together. The code from an
// invite link only pre-fills the form: a use is spent on submit, never on a GET, so
// link previews and prefetching cannot burn it.
export function JoinForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    join,
    null,
  );
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <label className="text-section">
        Invite code
        <input
          name="code"
          defaultValue={code}
          autoComplete="off"
          required
          className={FIELD}
        />
      </label>
      <label className="text-section">
        Name
        <input
          name="name"
          autoComplete="name"
          maxLength={80}
          required
          className={FIELD}
        />
      </label>
      <label className="text-section">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className={FIELD}
        />
      </label>
      <label className="text-section">
        Password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          className={FIELD}
        />
      </label>
      <Button type="submit" disabled={pending}>
        Create account
      </Button>
      {state === null ? null : (
        <p role="alert" className="text-wrong">
          {state.message}
        </p>
      )}
    </form>
  );
}
