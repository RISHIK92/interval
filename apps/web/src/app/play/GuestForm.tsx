"use client";

import { useActionState } from "react";
import type { FormState } from "../form";
import { Button } from "../ui/Button";
import { startGuestAction } from "./actions";

// ADR-0029, ADR-0056: play without an account; no invite code needed.
export function GuestForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    startGuestAction,
    null,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <Button type="submit" disabled={pending}>
        Play as a guest
      </Button>
      {state === null ? null : <p role="alert">{state.message}</p>}
    </form>
  );
}
