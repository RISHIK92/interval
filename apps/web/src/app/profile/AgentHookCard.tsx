import type { AgentDevice } from "../../server/ports";
import { revokeAgentDeviceAction } from "./actions";
import { AddDevice } from "./AddDevice";
import { NotifyHere } from "./NotifyHere";

const when = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// P3-W17-S04 (§7, C-09, Q-P3-28): the agent hook's devices. A device sends only
// "started" and "finished", never prompts or code.
export function AgentHookCard({
  devices,
  pushKey,
  canAdd,
}: {
  devices: AgentDevice[];
  pushKey: string | null; // P3-W17-S05b: web push offered once configured
  // ADR-0036: on a plan without the agent hook, devices can be revoked, not added.
  canAdd: boolean;
}) {
  return (
    <section aria-labelledby="agent-hook" className="flex flex-col gap-4">
      <div>
        <h2 id="agent-hook" className="text-section">
          Agent hook
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          When your coding agent starts a task, Interval offers a short session;
          when it finishes, your place is saved. It sends only
          &ldquo;started&rdquo; and &ldquo;finished&rdquo;: never prompts or
          code.
        </p>
      </div>
      {devices.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-hairline px-4 py-3"
            >
              <span>
                <span className="font-semibold">{d.name}</span>
                <span className="block text-sm text-ink-muted">
                  {d.lastUsedAt === null
                    ? "Not used yet"
                    : `Last used ${when(d.lastUsedAt)}`}
                </span>
              </span>
              <form action={revokeAgentDeviceAction}>
                <input type="hidden" name="device" value={d.id} />
                <button
                  type="submit"
                  aria-label={`Revoke ${d.name}`}
                  className="cursor-pointer rounded-full border border-hairline px-4 py-1.5 text-sm font-semibold"
                >
                  Revoke
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {canAdd ? <AddDevice /> : null}
      {pushKey === null ? null : <NotifyHere pushKey={pushKey} />}
    </section>
  );
}
