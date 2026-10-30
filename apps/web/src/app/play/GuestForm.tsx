"use client";

import { useActionState } from "react";
import type { FormState } from "../form";
import { Button } from "../ui/Button";
import { FIELD } from "../ui/field";
import { startGuestAction } from "./actions";

// ADR-0029: play without an account, with an invite code during the beta (Q-P1-24).
export function GuestForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    startGuestAction,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="text-section">
        Invite code
        <input name="code" autoComplete="off" required className={FIELD} />
      </label>
      <Button type="submit" disabled={pending}>
        Play as a guest
      </Button>
      {state === null ? null : <p role="alert">{state.message}</p>}
    </form>
  );
}
