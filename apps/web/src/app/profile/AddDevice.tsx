"use client";

import { useActionState } from "react";
import { Button } from "../ui/Button";
import { FIELD } from "../ui/field";
import { addAgentDeviceAction, type DeviceState } from "./actions";

// P3-W17-S04 (Q-P3-28): a device's token, shown this once with how to use it.
export function AddDevice() {
  const [state, action, pending] = useActionState<DeviceState, FormData>(
    addAgentDeviceAction,
    null,
  );
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="flex-1 text-sm font-semibold">
          Device name
          <input
            name="name"
            required
            maxLength={40}
            placeholder="Work laptop"
            className={FIELD}
          />
        </label>
        <Button type="submit" disabled={pending}>
          Add a device
        </Button>
      </form>
      {state === null ? null : "message" in state ? (
        <p role="alert" className="text-sm">
          {state.message}
        </p>
      ) : (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-2xl bg-well p-4"
        >
          <p className="font-semibold">
            Token for {state.name}: copy it now, it won&apos;t be shown again.
          </p>
          <code className="font-mono text-sm break-all">{state.token}</code>
          <p className="text-sm text-ink-muted">
            Save it with <code className="font-mono">interval login</code> and
            the token, set <code className="font-mono">INTERVAL_URL</code> to
            this site, then run{" "}
            <code className="font-mono">interval start</code> and{" "}
            <code className="font-mono">interval stop</code> around your
            agent&apos;s tasks (docs/agent-hook.md).
          </p>
        </div>
      )}
    </div>
  );
}
