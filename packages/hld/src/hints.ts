import { COMPONENT_NAMES, type ComponentKind, componentNames } from "./catalog";
import type { HldProblem } from "./problem";
import { REGION_NAMES } from "./spec";
import type { NodeResult, SimulationResult } from "./simulate";

// P6-W39 (Q-P6-03): the canvas's hints, by rule from the preview simulation; no model
// calls. The most serious first, at most MAX_HINTS, each naming what to look at in the
// player's words (component names, never ids), never the fix's numbers.
const MAX_HINTS = 5;

// "a", "a and b", "a, b and c"; past three, "a, b, c and 4 more" keeps a hint short.
const SHOWN = 3;
const list = (parts: { text: string; count: number }[]) => {
  const rest = parts.slice(SHOWN).reduce((n, p) => n + p.count, 0);
  const shown =
    parts.length > SHOWN + 1
      ? [...parts.slice(0, SHOWN).map((p) => p.text), `${String(rest)} more`]
      : parts.map((p) => p.text);
  return shown.length <= 1
    ? shown.join("")
    : `${shown.slice(0, -1).join(", ")} and ${shown.slice(-1).join("")}`;
};

// More than one of a kind, as a count: "2 app services", "3 search indexes".
const PLURALS: Partial<Record<ComponentKind, string>> = {
  object_storage: "object stores",
  search_index: "search indexes",
  external_api: "external providers",
};
const plural = (kind: ComponentKind) =>
  PLURALS[kind] ?? `${lower(COMPONENT_NAMES[kind])}s`;

// Mid-sentence: "the app service", but "the CDN" and "the SQL database" keep their caps.
const lower = (name: string) =>
  /^[A-Z][A-Z]/.test(name)
    ? name
    : name.charAt(0).toLowerCase() + name.slice(1);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// A request type as a word: "redirect" → "Redirect", "new_link" → "New link".
const typeName = (type: string) => capital(type.replaceAll("_", " "));

export function hints(problem: HldProblem, result: SimulationResult): string[] {
  if (result.scenarios.length === 0) return result.explanations.slice(0, 1);
  const found: string[] = [];
  const add = (hint: string) => {
    if (!found.includes(hint)) found.push(hint);
  };
  // ADR-0053: a picked provider by its name too: "external provider (MSG91 SMS)".
  const named = (nodes: NodeResult[]) => {
    const names = componentNames(nodes);
    return (n: NodeResult) =>
      lower(names.get(n.id) ?? n.kind) +
      (typeof n.provider === "string" ? ` (${n.provider})` : "");
  };
  const baseline = result.scenarios.find((s) => s.id === "baseline");
  // ADR-0053: a provider with nothing it can use does no work; that comes first, and
  // the types waiting on it aren't sent looking for a database.
  const unpicked = (baseline?.nodes ?? []).filter((n) => n.provider === null);
  // Where the problem offers a pick; a node's provider is set only then.
  const offer = problem.traffic.provider;
  const region = offer === undefined ? "" : REGION_NAMES[offer.region];
  for (const n of unpicked)
    add(
      `Pick the ${named(baseline?.nodes ?? [])(n)}'s provider and channel, from those offered in ${region}: until then it does no work.`,
    );
  for (const t of baseline?.types ?? [])
    if (
      t.availability === 0 &&
      !(
        unpicked.length > 0 &&
        problem.traffic.requests
          .find((r) => r.type === t.type)
          ?.requires?.includes("external_api") === true
      )
    ) {
      const write =
        problem.traffic.requests.find((r) => r.type === t.type)?.kind ===
        "write";
      add(
        write
          ? `${typeName(t.type)} requests aren't reaching anything that keeps them: connect them through an app service to a database.`
          : `${typeName(t.type)} requests aren't reaching anything that can answer them: connect them through an app service to a cache or database.`,
      );
    }
  if (!result.writesKept)
    add(
      "Nothing keeps the writes yet: connect the app service to a database or store.",
    );
  const overloaded = new Set<string>();
  for (const s of result.scenarios) {
    const name = named(s.nodes);
    for (const n of s.nodes)
      if (
        n.up &&
        n.utilization !== null &&
        n.utilization >= 1 &&
        !overloaded.has(n.id)
      ) {
        overloaded.add(n.id);
        // A third party can't be given capacity (spec 2.0): only waited for. Nor
        // can a hot key's partition (spec 2.1): more nodes leave it where it is.
        add(
          n.kind === "external_api"
            ? `The ${name(n)} hits its rate limit in "${s.name}": it can't be scaled, so queue its calls or make fewer.`
            : n.hot === true
              ? `The ${name(n)}'s busiest partition can't keep up in "${s.name}": one key takes most of its load, so more nodes won't help. Answer hot reads from a cache, or batch hot writes.`
              : `The ${name(n)} can't keep up in "${s.name}": give it more capacity.`,
        );
      }
  }
  // [lag], spec 2.0: asynchronous work done later than its target.
  for (const s of result.scenarios)
    for (const t of s.types) {
      const target = problem.traffic.requests.find(
        (r) => r.type === t.type,
      )?.completionSeconds;
      if (
        target !== undefined &&
        t.lagSeconds !== undefined &&
        // null: its backlog never drains
        (t.lagSeconds === null || t.lagSeconds > target)
      )
        add(
          `In "${s.name}", ${lower(typeName(t.type))} work isn't done in time: its backlog needs consumers with room to drain it, and a queue that keeps it long enough.`,
        );
    }
  for (const s of result.scenarios) {
    const name = named(s.nodes);
    // A provider's outage is the scenario itself: what matters is whether the design
    // waits it out.
    for (const n of s.nodes)
      if (!n.up && n.kind === "external_api" && !s.targetsMet)
        add(
          `In "${s.name}", the ${name(n)} is down and requests that call it fail: hand that work to a queue, so it waits instead.`,
        );
    // Spec 2.1: a coordinator is down when it loses its quorum, not its last member.
    for (const n of s.nodes)
      if (!n.up && n.kind === "coordination")
        add(
          `In "${s.name}", the ${name(n)} loses its quorum: place its members so that no one zone or region holds a majority of them.`,
        );
    // Grouped by kind, so a big design's outage still reads in one line.
    const down = new Map<ComponentKind, NodeResult[]>();
    for (const n of s.nodes)
      if (!n.up && n.kind !== "external_api" && n.kind !== "coordination")
        down.set(n.kind, [...(down.get(n.kind) ?? []), n]);
    const parts = [...down].map(([kind, [first, ...more]]) => ({
      text:
        first !== undefined && more.length === 0
          ? name(first)
          : `${String(more.length + 1)} ${plural(kind)}`,
      count: more.length + 1,
    }));
    const one = parts.length === 1 && parts[0]?.count === 1;
    if (parts.length > 0)
      add(
        `In "${s.name}", the ${list(parts)} ${one ? "goes" : "go"} down with nothing to take over: spread ${one ? "it" : "them"} over more zones or add failover.`,
      );
  }
  if (result.storageGb !== null && result.storageGb < result.storageNeededGb)
    add(
      `Storage runs out: the data grows to ${String(result.storageNeededGb)} GB by the end, so give it more room.`,
    );
  // ADR-0053: where the picked provider's fees are most of the cost, it's the pick.
  const picks = [
    ...new Set(
      (baseline?.nodes ?? []).flatMap((n) =>
        typeof n.provider === "string" ? [n.provider] : [],
      ),
    ),
  ];
  // Card fees answer to their own target (owner, 2026-11-24).
  const fees = result.fees;
  if (
    fees?.perPayment !== null &&
    fees !== undefined &&
    fees.perPayment > fees.target + 1e-9
  )
    add(
      `Fees per payment at ${list(picks.map((p) => ({ text: p, count: 1 })))} are over their target: compare what each payment provider charges in ${region} at this ticket.`,
    );
  if (result.costPerMonth > problem.budgetPerMonth)
    add(
      (result.providerCostPerMonth ?? 0) > result.costPerMonth / 2 &&
        picks.length > 0
        ? `The design costs more than the budget, and most of it is the ${list(picks.map((p) => ({ text: p, count: 1 })))} fees: send it only what it delivers, and compare what each provider and channel costs in ${region}.`
        : "The design costs more than the budget: trim capacity it doesn't use.",
    );
  const hot = new Set<string>();
  for (const s of result.scenarios) {
    const name = named(s.nodes);
    for (const n of s.nodes)
      if (
        n.utilization !== null &&
        n.utilization > 0.8 &&
        n.utilization < 1 &&
        !hot.has(n.id) &&
        !overloaded.has(n.id)
      ) {
        hot.add(n.id);
        add(
          `The ${name(n)} runs hot in "${s.name}": past 80% busy, waits grow fast.`,
        );
      }
  }
  return found.slice(0, MAX_HINTS);
}
