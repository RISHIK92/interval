import type { Design, DesignNode } from "./design";
import type { Cover, HldProblem } from "./problem";
import type { SimulationResult } from "./simulate";
import { COMPONENT_NAMES } from "./catalog";
import { specVersion } from "./spec";

// Q-WD-15: which of a problem's requirements a design covers, by the rules the problem
// carries (problem.ts's Cover), from the design and its simulation alone: no model, and
// nothing from the rubric. Shown live in practice and in matches.

export type CoverageItem = {
  text: string;
  covered: boolean;
  by: string | null; // what covers it, in words; null when nothing does
};
export type Coverage = {
  covered: number;
  total: number;
  items: CoverageItem[];
};

const fmt = (x: number) => Math.round(x).toLocaleString("en-US");
const count = (n: number, one: string, many = `${one}s`) =>
  `${fmt(n)} ${n === 1 ? one : many}`;

// The largest whole unit: 86,400 seconds reads as "1 day".
const duration = (seconds: number) => {
  for (const [unit, size] of [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ] as const)
    if (seconds >= size && seconds % size === 0)
      return count(seconds / size, unit);
  return count(seconds, "second");
};

// A component as the player knows it: its kind's name and the setting that sizes it.
function describe(node: DesignNode, design: Design): string {
  const name =
    specVersion(design.spec)?.components[node.kind]?.name ??
    COMPONENT_NAMES[node.kind];
  const detail = (() => {
    switch (node.kind) {
      case "client":
      case "load_balancer":
        return null;
      case "cdn":
        return `cached ${duration(node.config.ttlSeconds)}`;
      case "cache":
        return `${count(node.config.nodes, "node")} of ${fmt(node.config.memoryGbPerNode)} GB`;
      case "sql_db":
        return count(node.config.readReplicas, "read replica");
      case "queue":
      case "stream":
        return count(node.config.partitions, "partition");
      case "object_storage":
        return count(node.config.regions, "region");
      case "search_index":
        return count(node.config.shards, "shard");
      case "external_api":
        return null;
      default:
        return count(node.config.nodes, "node");
    }
  })();
  return detail === null ? name : `${name}, ${detail}`;
}

// The nodes a request type reaches from the client, following the edges that carry it.
function reached(design: Design, type: string): DesignNode[] {
  const client = design.nodes.find((n) => n.kind === "client");
  if (client === undefined) return [];
  const seen = new Set([client.id]);
  const todo = [client.id];
  for (let id = todo.pop(); id !== undefined; id = todo.pop())
    for (const e of design.edges)
      if (e.from === id && e.routes.includes(type) && !seen.has(e.to)) {
        seen.add(e.to);
        todo.push(e.to);
      }
  return design.nodes.filter((n) => seen.has(n.id) && n.id !== client.id);
}

function check(
  cover: Cover,
  problem: HldProblem,
  design: Design,
  simulation: SimulationResult,
): string | null {
  // An empty result: the design couldn't be simulated, so nothing is shown covered.
  const baseline = simulation.scenarios.find((s) => s.id === "baseline");
  if (baseline === undefined) return null;
  switch (cover.rule) {
    case "request": {
      const through = reached(design, cover.request).filter((n) =>
        cover.through.includes(n.kind),
      );
      const result = baseline.types.find((t) => t.type === cover.request);
      if (
        through.length === 0 ||
        result === undefined ||
        result.availability <= 0
      )
        return null;
      const by = [...new Set(through.map((n) => describe(n, design)))].join(
        "; ",
      );
      if (cover.fast !== true) return by;
      // [lag]: an asynchronous type is fast when its work is done within its target.
      const completion = problem.traffic.requests.find(
        (r) => r.type === cover.request,
      )?.completionSeconds;
      // A null lag is a backlog that never drains: never done in time.
      if (result.lagSeconds !== undefined && completion !== undefined)
        return result.lagSeconds !== null && result.lagSeconds <= completion
          ? `${by}; done within ${result.lagSeconds < 1 ? "a second" : duration(Math.ceil(result.lagSeconds))}`
          : null;
      const target =
        problem.scenarios.find((s) => s.id === "baseline")?.targets.p99Ms ?? 0;
      return result.p99Ms !== null && result.p99Ms <= target
        ? `${by}; p99 ${fmt(result.p99Ms)} ms`
        : null;
    }
    case "scenario": {
      const s = simulation.scenarios.find((x) => x.id === cover.scenario);
      if (s?.targetsMet !== true) return null;
      const p99 = s.p99Ms === null ? "" : `p99 ${fmt(s.p99Ms)} ms, `;
      // Floored, so 99.996% never shows as 100%.
      const share = Number(
        (Math.floor(s.availability * 10_000) / 100).toFixed(2),
      );
      return `${s.name}: ${p99}${String(share)}% served`;
    }
    case "storage":
      if (!simulation.writesKept) return null;
      if (simulation.storageGb === null)
        return simulation.storageNeededGb > 0
          ? "Object storage, no limit"
          : "Nothing to keep";
      return simulation.storageGb >= simulation.storageNeededGb
        ? `Room for ${fmt(simulation.storageGb)} GB of the ${fmt(simulation.storageNeededGb)} GB needed`
        : null;
    // A design that can't carry a normal day is cheap for nothing.
    case "budget":
      return baseline.targetsMet &&
        simulation.costPerMonth <= problem.budgetPerMonth
        ? `$${fmt(simulation.costPerMonth)} a month`
        : null;
  }
}

// `simulation` is simulate(problem, design)'s result.
export function coverage(
  problem: HldProblem,
  design: Design,
  simulation: SimulationResult,
): Coverage {
  const items = problem.requirements.map((text, i) => {
    const cover = problem.covers?.[i];
    const by =
      cover === undefined ? null : check(cover, problem, design, simulation);
    return { text, covered: by !== null, by };
  });
  return {
    covered: items.filter((x) => x.covered).length,
    total: items.length,
    items,
  };
}
