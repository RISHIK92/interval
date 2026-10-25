"use client";

import { useActionState } from "react";
import { join, type JoinState } from "./actions";

// The code from an invite link only pre-fills the form: a use is spent on submit, never
// on a GET, so link previews and prefetching cannot burn it.
export function JoinForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(
    join,
    null,
  );
  return (
    <form action={action}>
      <label htmlFor="code">Invite code</label>
      <input
        id="code"
        name="code"
        defaultValue={code}
        autoComplete="off"
        required
      />
      <button type="submit" disabled={pending}>
        Join
      </button>
      {state === null ? null : <p role="alert">{state.message}</p>}
    </form>
  );
}
