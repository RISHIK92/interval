import {
  type ComponentKind,
  type ComponentStats,
  LATEST_SPEC,
  SPEC_VERSIONS,
} from "@interval/hld";
import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "../../ui/Card";
import { PAGE_TITLE } from "../../ui/Page";

// P6-W36 (CANVAS-4; Q-P6-01): the public spec sheet: every component's numbers, as the
// simulator uses them, and each version's patch notes. No sign-in: players study it
// before a battle, as they would a game's balance sheet. ADR-0050 §6: the newest
// version's sheet, with what each version added marked, since a version only adds
// (1.0's numbers are 2.0's less what's new). A family stays on the version it was made
// on (owner, 2026-11-24): a new version, from its season boundary, is only its own
// families'.
export const metadata: Metadata = {
  title: "HLD spec sheet",
  description: "The components of Interval's HLD battles and their numbers.",
};

// "2026-11-14" as "14 Nov 2026", the same in every zone (a date, not a moment).
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const n = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

const STATS = ["Capacity", "Latency", "Availability", "Cost / node-hour"];

// The version a component first appears in, and the version before the newest.
const since = (kind: string) =>
  SPEC_VERSIONS.find((v) => kind in v.components)?.version ?? null;
const PREVIOUS = SPEC_VERSIONS.at(-2);

function capacity(s: ComponentStats): string {
  if (s.setByProblem !== undefined) return `Set by each problem: ${s.unit}`;
  return [
    `${n(s.capacity)} ${s.unit}`,
    ...(s.writeCapacity === undefined
      ? []
      : [`writes ${n(s.writeCapacity)}/s on the primary`]),
    ...(s.bandwidthMbps === undefined
      ? []
      : [`${n(s.bandwidthMbps)} Mbps of payload from ${LATEST_SPEC.version}`]),
  ].join("; ");
}
const ROW =
  "lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] lg:gap-4";

// Static and public: no session read, so no app frame (the sidebar names the player).
export default function SpecPage() {
  const spec = LATEST_SPEC;
  const components = (
    Object.entries(spec.components) as [ComponentKind, ComponentStats][]
  ).filter(([kind]) => kind !== "client");
  const { bytes, lag } = spec.features;
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 pt-6 pb-12 lg:gap-5 lg:px-8 lg:py-10">
      <header>
        {/* Static, so no frame: a way back to the lobby, and the first stop for Tab. */}
        <Link
          href="/hld/play"
          className="mb-3 inline-flex rounded-md text-[15px] font-semibold text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select"
        >
          ‹ HLD battles
        </Link>
        <h1 className={PAGE_TITLE}>HLD spec sheet</h1>
        <p className="mt-1 text-ink-muted">
          Version {spec.version}, from {day(spec.date)}, a season boundary.
          {PREVIOUS === undefined
            ? ""
            : ` Families made on version ${PREVIOUS.version} stay on it, before and after that boundary; only families made for ${spec.version} run on ${spec.version}, from it. ${PREVIOUS.version}'s numbers are these, less what's marked new.`}{" "}
          Every simulation runs against one version, and a match keeps the
          version it was drawn on. Numbers change only at season boundaries,
          with patch notes.
          {spec.provisional
            ? " These numbers are provisional until launch."
            : ""}
        </p>
      </header>
      <Card className="lg:rounded-[22px] lg:shadow-none">
        <div
          aria-hidden="true"
          className={`hidden border-b border-hairline px-[18px] py-3 text-[13px] font-medium text-ink-muted ${ROW}`}
        >
          <span>Component</span>
          {STATS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <ul aria-label="Components" className="tabular-nums">
          {components.map(([kind, s]) => (
            <li
              key={kind}
              className={`border-t border-hairline px-5 py-4 first:border-t-0 lg:px-[18px] lg:py-3.5 ${ROW}`}
            >
              <div>
                <p className="font-semibold">
                  {s.name}
                  {since(kind) === null ||
                  since(kind) === SPEC_VERSIONS[0]?.version ? null : (
                    <span className="ml-2 rounded-full bg-well px-2 py-0.5 text-[12px] font-medium text-ink-muted">
                      New in {since(kind)}
                    </span>
                  )}
                </p>
                <p className="text-sm text-ink-muted">{s.summary}</p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm lg:col-span-4 lg:mt-0 lg:grid-cols-subgrid">
                {[
                  capacity(s),
                  `${String(s.latencyMs)} ms${
                    s.writeLatencyMs === undefined
                      ? ""
                      : `; writes ${String(s.writeLatencyMs)} ms`
                  }`,
                  percent(s.availability),
                  s.setByProblem === undefined
                    ? `$${s.costPerNodeHour.toFixed(3)}`
                    : "Per call, set by each problem",
                ].map((value, i) => (
                  <div key={STATS[i]}>
                    <dt className="text-[13px] text-ink-muted lg:sr-only">
                      {STATS[i]}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </Card>
      {bytes === undefined && lag === undefined ? null : (
        <section aria-label="Engine" className="flex flex-col gap-3">
          <h2 className="text-section">The engine, from {spec.version}</h2>
          <Card className="p-5 lg:rounded-[22px] lg:p-[18px] lg:shadow-none">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-soft">
              {bytes === undefined ? null : (
                <li>
                  {`Bytes served to players: $${bytes.cdnEgressPerGb.toFixed(2)} a GB from a CDN, $${bytes.originEgressPerGb.toFixed(2)} a GB from anything else.`}
                </li>
              )}
              {lag === undefined ? null : (
                <li>
                  {`A spike or outage lasts ${String(lag.defaultScenarioMinutes)} minutes unless its scenario says otherwise; a backlog then drains at the spare capacity of a normal day.`}
                </li>
              )}
            </ul>
          </Card>
        </section>
      )}
      <section aria-label="Patch notes" className="flex flex-col gap-3">
        <h2 className="text-section">Patch notes</h2>
        <ol className="flex flex-col gap-3">
          {[...SPEC_VERSIONS].reverse().map((v) => (
            <li key={v.version}>
              <Card className="p-5 lg:rounded-[22px] lg:p-[18px] lg:shadow-none">
                <p className="font-semibold tabular-nums">
                  {v.version}{" "}
                  <span className="font-normal text-ink-muted">
                    · {day(v.date)}
                  </span>
                </p>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-soft">
                  {v.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
