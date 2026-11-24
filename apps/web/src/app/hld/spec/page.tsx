import {
  type ComponentKind,
  type ComponentStats,
  type Features,
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

// The version a component, a component's bandwidth or an engine feature first appears
// in, and the versions before the newest.
const since = (kind: string) =>
  SPEC_VERSIONS.find((v) => kind in v.components)?.version ?? null;
const bandwidthSince = (kind: ComponentKind) =>
  SPEC_VERSIONS.find((v) => v.components[kind]?.bandwidthMbps !== undefined)
    ?.version ?? LATEST_SPEC.version;
const featureSince = (feature: keyof Features) =>
  SPEC_VERSIONS.find((v) => v.features[feature] !== undefined)?.version ??
  LATEST_SPEC.version;
const EARLIER = SPEC_VERSIONS.slice(0, -1).map((v) => v.version);
const versions = (list: string[]) =>
  list.length <= 1
    ? list.join("")
    : `${list.slice(0, -1).join(", ")} and ${list.slice(-1).join("")}`;

// Where a kind's writes go (ADR-0050 §2): a database's primary, a geo index's shards,
// a coordinator's leader.
const WRITES: Partial<Record<ComponentKind, string>> = {
  sql_db: "on the primary",
  geo_index: "per shard",
  coordination: "through its leader, at 3 members",
};

function capacity(kind: ComponentKind, s: ComponentStats): string {
  if (s.setByProblem !== undefined) return `Set by each problem: ${s.unit}`;
  return [
    `${n(s.capacity)} ${s.unit}`,
    ...(s.connectionCapacity === undefined
      ? []
      : [`${n(s.connectionCapacity)} connections per node`]),
    ...(s.writeCapacity === undefined
      ? []
      : [`writes ${n(s.writeCapacity)}/s ${WRITES[kind] ?? ""}`.trim()]),
    ...(s.bandwidthMbps === undefined
      ? []
      : [`${n(s.bandwidthMbps)} Mbps of payload from ${bandwidthSince(kind)}`]),
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
  const { bytes, lag, geo, gateway, coordination, fanout, hot, batch } =
    spec.features;
  // The engine's rules, each with the version it arrived in.
  const engine: [keyof Features, string | null][] = [
    [
      "bytes",
      bytes === undefined
        ? null
        : `Bytes served to players: $${bytes.cdnEgressPerGb.toFixed(2)} a GB from a CDN, $${bytes.originEgressPerGb.toFixed(2)} a GB from anything else.`,
    ],
    [
      "lag",
      lag === undefined
        ? null
        : `A spike or outage lasts ${String(lag.defaultScenarioMinutes)} minutes unless its scenario says otherwise; a backlog then drains at the spare capacity of a normal day.`,
    ],
    [
      "geo",
      geo === undefined
        ? null
        : `A nearby query asks the shards of ${String(geo.cellsPerQuery)} cells, however many shards there are.`,
    ],
    [
      "gateway",
      gateway === undefined
        ? null
        : `Clients a lost gateway server held reconnect within ${String(gateway.reconnectWindowSeconds)} seconds, through whatever checks their sessions.`,
    ],
    [
      "coordination",
      coordination === undefined
        ? null
        : `A coordination service holds at most ${String(coordination.storageGb)} GB. A commit takes ${String(coordination.crossZoneMs)} ms more across zones and ${String(coordination.crossRegionMs)} ms more across regions. A lost region takes the second region's members, the smaller half.`,
    ],
    [
      "fanout",
      fanout === undefined
        ? null
        : `A request's deliveries go out ${String(fanout.parallelism)} at a time.`,
    ],
    [
      "hot",
      hot === undefined
        ? null
        : "A hot key's share of a request type lands on one partition of a key-value store, stream, queue or geo index.",
    ],
    [
      "batch",
      batch === undefined
        ? null
        : `A batching worker waits at most ${String(batch.maxWaitSeconds)} seconds to fill a batch.`,
    ],
  ];
  const rules = engine.flatMap(([feature, text]) =>
    text === null ? [] : [{ feature, text }],
  );
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
          {EARLIER.length === 0
            ? ""
            : ` Families made on ${EARLIER.length === 1 ? "version" : "versions"} ${versions(EARLIER)} stay on ${EARLIER.length === 1 ? "it" : "them"}, before and after that boundary; only families made for ${spec.version} run on ${spec.version}, from it. Each earlier version's numbers are these, less what's marked new since it.`}{" "}
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
                  capacity(kind, s),
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
      {rules.length === 0 ? null : (
        <section aria-label="Engine" className="flex flex-col gap-3">
          <h2 className="text-section">The engine</h2>
          <Card className="p-5 lg:rounded-[22px] lg:p-[18px] lg:shadow-none">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-soft">
              {rules.map(({ feature, text }) => (
                <li key={feature}>
                  {`${text} From ${featureSince(feature)}.`}
                </li>
              ))}
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
