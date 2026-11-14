import { CURRENT_SPEC, SPEC_VERSIONS } from "@interval/hld";
import type { Metadata } from "next";

// P6-W36 (CANVAS-4; Q-P6-01): the public spec sheet: every component's numbers, as the
// simulator uses them, and each version's patch notes. No sign-in: players study it
// before a battle, as they would a game's balance sheet.
export const metadata: Metadata = {
  title: "HLD spec sheet",
  description: "The components of Interval's HLD battles and their numbers.",
};

const n = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

export default function SpecPage() {
  const spec = CURRENT_SPEC;
  const components = Object.entries(spec.components).filter(
    ([kind]) => kind !== "client",
  );
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-display">HLD spec sheet</h1>
        <p className="mt-1 text-ink-muted">
          Version {spec.version}, from {spec.date}. Every simulation runs
          against one version. Numbers change only at season boundaries, with
          patch notes.
          {spec.provisional
            ? " These numbers are provisional until launch."
            : ""}
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="py-2 pr-3">Component</th>
              <th className="py-2 pr-3">Capacity</th>
              <th className="py-2 pr-3">Latency</th>
              <th className="py-2 pr-3">Availability</th>
              <th className="py-2 pr-3">Cost / node-hour</th>
            </tr>
          </thead>
          <tbody>
            {components.map(([kind, s]) => (
              <tr key={kind} className="border-t border-line align-top">
                <td className="py-2 pr-3">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-ink-muted">{s.summary}</p>
                </td>
                <td className="py-2 pr-3">
                  {n(s.capacity)} {s.unit}
                  {s.writeCapacity === undefined
                    ? ""
                    : `; writes ${n(s.writeCapacity)}/s on the primary`}
                </td>
                <td className="py-2 pr-3">
                  {s.latencyMs} ms
                  {s.writeLatencyMs === undefined
                    ? ""
                    : `; writes ${String(s.writeLatencyMs)} ms`}
                </td>
                <td className="py-2 pr-3">{percent(s.availability)}</td>
                <td className="py-2 pr-3">${s.costPerNodeHour.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-label="Patch notes">
        <h2 className="text-title">Patch notes</h2>
        <ol className="mt-2 flex flex-col gap-3">
          {[...SPEC_VERSIONS].reverse().map((v) => (
            <li key={v.version}>
              <p className="font-semibold">
                {v.version} · {v.date}
              </p>
              <ul className="list-disc pl-5 text-sm">
                {v.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
