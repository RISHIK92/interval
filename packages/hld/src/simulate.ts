import { COMPONENT_NAMES, type ComponentKind } from "./catalog";
import type { Design, DesignNode } from "./design";
import type { HldProblem, Scenario } from "./problem";
import { picked, pickLabel } from "./providers";
import { type SpecVersion, specVersion, statsOf } from "./spec";

// P6-W37 (CANVAS-3, CANVAS-5; Q-P6-02): the analytical simulator. The same code runs in
// the browser (preview) and on the server (the official score), so it is pure: no I/O,
// no clock, no randomness; one design and problem always give one result, in time
// linear in the design (its edges never cycle).
//
// Per scenario:
// 1. Failures take servers, zones or regions away from each component.
// 2. Each request type flows from the client in topological order. A cache or CDN may
//    answer a cacheable read and passes its misses on (cache-aside: the sender asks its
//    other targets; read-through: the cache asks its own); anything else passes through
//    it. A sender's other targets are each called in turn. A queue or stream ends the
//    request's synchronous path, and its consumers take the load on.
// 3. Each component is M/M/c (its wait from Erlang C), its availability from what really
//    protects it (spare servers, replicas, replication), times the share of its load it
//    can serve.
// 4. A request is served only when its path reaches somewhere that keeps or does the
//    work (a database, store, index or worker), and a cache hits only with an origin
//    behind it. Latencies add along the synchronous path, a cache's misses counting when
//    there are enough of them to show.
// 5. Targets (p99, availability, the budget, storage) score the scenario; a scenario
//    that serves nothing scores nothing. Every verdict is explained.
//
// Spec 2.0 (ADR-0050 stage 1) adds, each only when the design's spec version has the
// feature and the problem sets its field, so a 1.0 design's result never moves: the
// external provider (a station at the problem's rate limit, billed per call); [lag], a
// queue's backlog that drains after a spike or outage instead of failing it; [work],
// a job's cost at a worker; [bytes], payload bandwidth and egress; and (ADR-0051) what
// a request type requires to do its work, without which it isn't served.
//
// Spec 2.1 (ADR-0050 stage 2, ADR-0052) adds, likewise gated: the geo index (a nearby
// query asks a few cells' shards), the connection gateway (connections held, push
// delivery, a reconnect storm when its servers are lost), the coordination service (a
// quorum, a leader's write ceiling, a cap on what it holds), [fanout], [hot] and
// [batch].
//
// ADR-0053 (spec 2.0's amendment): where the problem offers it, the player picks the
// external provider's provider and channel. The pick sets its price, from the sheet's
// table for the problem's region, and its availability where the provider publishes an
// SLA. A provider with no usable pick does no work.

export const SIMULATION_POINTS = 60; // §6.4

const DATASTORES = new Set<ComponentKind>([
  "sql_db",
  "kv_store",
  "object_storage",
  "search_index",
  // Spec 2.1: they answer what's asked of them, but the storage rule never counts a geo
  // index (memory only) and holds a coordinator to its cap.
  "geo_index",
  "coordination",
]);
// Writes go to their own servers: a database's primary, a geo index's shard groups, a
// coordinator's leader.
const SPLIT = new Set<ComponentKind>(["sql_db", "geo_index", "coordination"]);
// [hot], spec 2.1: what has partitions that a hot key can overload.
const PARTITIONED = new Set<ComponentKind>([
  "kv_store",
  "stream",
  "queue",
  "geo_index",
]);
const isCache = (kind: ComponentKind) => kind === "cache" || kind === "cdn";
const isAsync = (kind: ComponentKind) => kind === "queue" || kind === "stream";
// Shares compared within a whisker: 1 − 0.99 is 0.010000000000000009.
const EPS = 1e-9;

export type NodeResult = {
  id: string;
  kind: ComponentKind;
  up: boolean;
  servers: number;
  loadRps: number;
  utilization: number | null; // null: down
  p50Ms: number | null; // null: unbounded (down or overloaded)
  p99Ms: number | null;
  // [hot], spec 2.1: its busiest partition, not its size, sets its utilization.
  hot?: true;
  // ADR-0053: an external provider's pick ("MSG91 SMS"), where the problem offers one;
  // null when it has none it can use.
  provider?: string | null;
};
type TypeResult = {
  type: string;
  p50Ms: number | null; // null: unbounded, or nothing served
  p99Ms: number | null;
  availability: number; // the share served
  overloaded: boolean;
  // [lag], spec 2.0: the worst wait for its asynchronous work, in seconds; null when
  // its backlog never drains. Present only for a request type with a completion target.
  lagSeconds?: number | null;
};
export type ScenarioResult = {
  id: string;
  name: string;
  weight: number;
  score: number; // 0..1 of its weight
  targetsMet: boolean;
  p99Ms: number | null;
  availability: number;
  types: TypeResult[];
  nodes: NodeResult[];
  explanations: string[];
};
export type SimulationResult = {
  spec: string;
  costPerMonth: number;
  storageNeededGb: number;
  storageGb: number | null; // where writes are kept; null: unlimited, or nowhere
  writesKept: boolean; // some write reaches a datastore (or nothing needs keeping)
  scenarios: ScenarioResult[];
  points: number; // of SIMULATION_POINTS
  baselinePassed: boolean; // §6.4's gate for the rubric points
  explanations: string[]; // what applies to every scenario
  // ADR-0053: the picked providers' charges a month inside the cost, where the problem
  // offers a pick.
  providerCostPerMonth?: number;
  // Card payments (owner, 2026-11-24): the fee per payment (null: no usable pick),
  // its target, and the month's fees, all paid apart from the infrastructure budget.
  fees?: { perPayment: number | null; target: number; perMonth: number };
};

// One component in a scenario: its servers (c), what failures left of it, and the load
// sent to it. A relational database's writes go to its primary alone.
type Station = {
  node: DesignNode;
  up: boolean;
  servers: number;
  writeServers: number;
  redundancy: number; // copies protecting a request's data or work
  writeRedundancy: number;
  shards: number; // a search query needs every shard
  lostShare: number; // data a failure made unreachable, with no copy left
  load: number;
  writeLoad: number;
  mbps: number; // [bytes]: payload arriving, in megabits a second
  // Spec 2.1: the connections a gateway holds; [hot] the load on the busiest server for
  // reads and for writes (its even share, plus a hot type's share).
  conns: number;
  busiest: number;
  writeBusiest: number;
  // The copies a hot read's share is spread over: each is as busy as the busiest.
  hotCopies: number;
};
// A coordinator's quorum: a majority of all its members.
const majority = (members: number) => Math.floor(members / 2) + 1;
// The chance at least `need` of `n` members are up, each with availability `a`.
function quorumUp(n: number, need: number, a: number): number {
  let p = 0;
  let choose = 1;
  for (let k = 0; k <= n; k++) {
    if (k > 0) choose = (choose * (n - k + 1)) / k;
    if (k >= need) p += choose * a ** k * (1 - a) ** (n - k);
  }
  return p;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (x: number) => Math.round(x).toLocaleString("en-US");
const finite = (x: number) => (Number.isFinite(x) ? r1(x) : null);
const kindName = (kind: ComponentKind) => COMPONENT_NAMES[kind].toLowerCase();
const aKind = (kind: ComponentKind) =>
  `${/^[aeiou]/.test(kindName(kind)) ? "an" : "a"} ${kindName(kind)}`;
// [lag]'s waits in words: "40 seconds", "9 minutes", "2.5 hours".
const duration = (seconds: number) =>
  seconds < 90
    ? `${String(Math.round(seconds))} seconds`
    : seconds < 5400
      ? `${String(Math.round(seconds / 60))} minutes`
      : `${String(r1(seconds / 3600))} hours`;

// The probability a request waits, for c servers at offered load a = λ/μ (a < c), from
// Erlang B's recurrence (stable for large c).
export function erlangC(c: number, a: number): number {
  let b = 1;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  return (c * b) / (c - a * (1 - b));
}

// p50 and p99 of an M/M/c station's response, in ms: its base latency plus the wait,
// whose tail is P(W > t) = C·e^(−(cμ−λ)t). Overloaded: unbounded.
export function stationLatency(
  servers: number,
  rate: number,
  load: number,
  baseMs: number,
): { p50: number; p99: number; utilization: number } {
  if (load <= 0) return { p50: baseMs, p99: baseMs, utilization: 0 };
  const utilization = load / (servers * rate);
  if (utilization >= 1) return { p50: Infinity, p99: Infinity, utilization };
  const c = erlangC(servers, load / rate);
  const drain = servers * rate - load; // per second
  const waitMs = (p: number) => (c > p ? (Math.log(c / p) / drain) * 1000 : 0);
  return { p50: baseMs + waitMs(0.5), p99: baseMs + waitMs(0.01), utilization };
}

const zonesOf = (n: DesignNode) => ("zones" in n.config ? n.config.zones : 1);
const regionsOf = (n: DesignNode) =>
  "regions" in n.config ? n.config.regions : 1;
// Servers left after losing `share` of them: at least one goes.
const lose = (servers: number, share: number) =>
  Math.max(0, servers - Math.max(1, Math.ceil(servers * share)));

function station(
  node: DesignNode,
  scenario: Scenario,
  spec: SpecVersion,
): Station {
  const regions = regionsOf(node);
  const st: Station = {
    node,
    up: true,
    servers: 1,
    writeServers: 1,
    redundancy: 1,
    writeRedundancy: 1,
    shards: 1,
    lostShare: 0,
    load: 0,
    writeLoad: 0,
    mbps: 0,
    conns: 0,
    busiest: 0,
    writeBusiest: 0,
    hotCopies: 1,
  };
  // Every region is active: a second one doubles capacity (and cost).
  switch (node.kind) {
    case "client":
    case "external_api": // one rate-limited station, wherever it is
      break;
    case "object_storage":
      // Managed within a region; a second region holds a copy that serves on its own.
      st.servers = regions;
      st.redundancy = regions;
      break;
    case "cdn":
      st.servers = spec.engine.cdnPointsOfPresence;
      break;
    case "load_balancer":
      st.servers = node.config.zones * regions;
      st.redundancy = st.servers;
      break;
    case "sql_db":
      // Reads: the primary and its replicas, in every region; writes: the primary,
      // kept up by a standby when there is one.
      st.servers = (1 + node.config.readReplicas) * regions;
      st.redundancy = st.servers;
      st.writeRedundancy = node.config.failover === "none" ? 1 : 2;
      break;
    case "kv_store":
      st.servers = node.config.nodes * regions;
      st.redundancy = node.config.replication;
      break;
    case "stream":
      st.servers = node.config.partitions * regions;
      st.redundancy = node.config.replication;
      break;
    case "queue":
      st.servers = node.config.partitions * regions;
      break;
    case "search_index":
      // A query asks every shard; a shard's replicas share its queries and cover its
      // failures.
      st.servers = (1 + node.config.replicas) * regions;
      st.redundancy = 1 + node.config.replicas;
      st.shards = node.config.shards;
      break;
    case "geo_index":
      // Reads: every shard replica answers its cells' queries. Writes: a shard's
      // replicas apply each of its updates side by side, so a shard is one write server.
      st.servers = (1 + node.config.replicas) * node.config.shards * regions;
      st.writeServers = node.config.shards * regions;
      st.redundancy = 1 + node.config.replicas;
      st.writeRedundancy = st.redundancy;
      st.shards = Math.min(
        spec.features.geo?.cellsPerQuery ?? 1,
        node.config.shards,
      );
      break;
    case "coordination":
      // Reads from any member; every write through the one leader.
      st.servers = node.config.members;
      st.writeServers = 1;
      break;
    default: // app_service, cache, worker, connection_gateway
      st.servers = node.config.nodes * regions;
      st.redundancy = st.servers;
  }
  if (!SPLIT.has(node.kind)) {
    st.writeServers = st.servers;
    st.writeRedundancy = st.redundancy;
  }

  const failure = scenario.failure;
  if (failure === undefined || node.kind === "client") return st;
  // A quorum: a node's loss takes one member, a zone's the zone holding most of them
  // (spread evenly, the remainder in the first zones), a region's the second region's
  // share (the remainder stays with the first, as a primary's majority would; ADR-0052).
  // Below a majority of all its members, it's down.
  if (node.kind === "coordination") {
    const members = node.config.members;
    const lost =
      failure.scope === "node"
        ? (failure.kind ?? node.kind) === node.kind
          ? 1
          : 0
        : failure.scope === "zone"
          ? // The lost zone is in the region a region's loss would take.
            Math.ceil(
              (regions === 1 ? members : Math.floor(members / regions)) /
                node.config.zones,
            )
          : regions === 1
            ? members
            : Math.floor(members / regions);
    st.servers = members - lost;
    if (st.servers < majority(members)) st.up = false;
    return st;
  }
  const oneCopy =
    (node.kind === "kv_store" ||
      node.kind === "stream" ||
      node.kind === "geo_index") &&
    st.redundancy === 1;
  // A third party fails only when a scenario names it ("the provider is down"); our
  // zones and regions aren't its.
  if (node.kind === "external_api") {
    if (failure.scope === "node" && failure.kind === "external_api")
      st.up = false;
    return st;
  }
  if (failure.scope === "node" && (failure.kind ?? node.kind) === node.kind) {
    switch (node.kind) {
      case "cdn":
      case "object_storage":
        break; // managed: one machine's loss doesn't show
      case "sql_db":
        // The primary fails: a standby takes over; with none, writes stop and reads
        // stay on the replicas.
        if (node.config.failover === "none") {
          st.writeServers = 0;
          st.servers -= 1;
        }
        break;
      case "search_index":
        st.servers -= 1;
        if (node.config.replicas === 0) st.up = false; // a shard with no copy
        break;
      case "geo_index":
        st.servers -= 1;
        if (node.config.replicas === 0) st.up = false;
        break;
      default:
        if (oneCopy) st.lostShare = 1 / st.servers;
        st.servers -= 1;
        st.writeServers -= 1;
    }
  }
  if (
    failure.scope === "zone" &&
    node.kind !== "cdn" &&
    node.kind !== "object_storage"
  ) {
    // A zone is inside one region: the others carry on.
    if (node.kind === "sql_db") {
      // In the failed zone's region, only a standby in another zone keeps the primary,
      // and half its replicas go too; with none, writes stop and that region's reads.
      const { readReplicas: replicas, failover } = node.config;
      const others = (regions - 1) * (1 + replicas);
      const left = failover === "multi_zone" ? 1 + Math.floor(replicas / 2) : 0;
      st.servers = others + left;
      if (failover !== "multi_zone") st.writeServers = 0;
    } else if (zonesOf(node) * regions === 1) st.up = false;
    else {
      const share = 1 / (zonesOf(node) * regions);
      st.servers = lose(st.servers, share);
      st.writeServers = lose(st.writeServers, share);
      if (oneCopy) st.lostShare = share;
    }
  }
  if (failure.scope === "region" && node.kind !== "cdn") {
    if (regions === 1) st.up = false;
    else {
      const share = 1 / regions;
      st.servers = lose(st.servers, share);
      if (node.kind !== "sql_db")
        st.writeServers = lose(st.writeServers, share);
      // The primary's region is gone: with a standby, another region takes over.
      else if (node.config.failover === "none") st.writeServers = 0;
    }
  }
  if (st.servers <= 0) st.up = false;
  return st;
}

// A cache's hit rate: the share of the working set it holds, raised so that skew (hot
// keys) helps: f^(1−skew). A CDN's comes from its TTL against how often content changes.
function hitRate(st: Station, problem: HldProblem, spec: SpecVersion): number {
  const n = st.node;
  const e = spec.engine;
  if (!st.up) return 0;
  if (n.kind === "cdn")
    return Math.min(
      e.maxCdnHitRate,
      n.config.ttlSeconds / (n.config.ttlSeconds + e.cdnContentChangeSeconds),
    );
  if (n.kind !== "cache") return 0;
  const held = Math.min(
    1,
    // Each region holds its own copy, so only one region's memory counts.
    ((st.servers / regionsOf(n)) * n.config.memoryGbPerNode) /
      problem.traffic.workingSetGb,
  );
  return Math.min(e.maxCacheHitRate, held ** (1 - problem.traffic.hotKeySkew));
}

// What follows a component on a request's path: its added p50 and p99, the share
// served, whether something overloads, and whether the path reaches somewhere that
// does the work at all.
// `util`: the busiest station on it (Infinity when one is down), which [lag] reads to
// size a backlog and its drain.
type Rest = {
  p50: number;
  p99: number;
  served: number;
  overloaded: boolean;
  reaches: boolean;
  util: number;
};
const NOTHING: Rest = {
  p50: 0,
  p99: 0,
  served: 1,
  overloaded: false,
  reaches: true,
  util: 0,
};
const DEAD: Rest = { ...NOTHING, served: 0, reaches: false };
const seq = (a: Rest, b: Rest): Rest => ({
  p50: a.p50 + b.p50,
  p99: a.p99 + b.p99,
  served: a.served * b.served,
  overloaded: a.overloaded || b.overloaded,
  reaches: a.reaches && b.reaches,
  util: Math.max(a.util, b.util),
});
// A cache's hits end the request; its misses go on. With no origin behind it, nothing
// is ever cached. The miss path counts toward p50 when most requests miss, toward p99
// when more than 1% do.
const mix = (hit: number, miss: Rest): Rest =>
  miss.reaches
    ? {
        p50: 1 - hit > 0.5 + EPS ? miss.p50 : 0,
        p99: 1 - hit > 0.01 + EPS ? miss.p99 : 0,
        served: hit + (1 - hit) * miss.served,
        overloaded: 1 - hit > EPS && miss.overloaded,
        reaches: true,
        util: 1 - hit > EPS ? miss.util : 0,
      }
    : DEAD;

function costPerMonth(design: Design, spec: SpecVersion): number {
  const e = spec.engine;
  let hourly = 0;
  let monthly = 0;
  for (const n of design.nodes) {
    const per = statsOf(spec, n.kind).costPerNodeHour;
    const regions = regionsOf(n);
    switch (n.kind) {
      case "client":
      case "external_api": // billed per call (usageCost)
        break;
      case "cdn":
      case "object_storage":
        hourly += per * regions;
        break;
      case "load_balancer":
        hourly += per * n.config.zones * regions;
        break;
      case "cache":
        hourly +=
          (per + n.config.memoryGbPerNode * e.cacheMemoryCostPerGbHour) *
          n.config.nodes *
          regions;
        break;
      case "sql_db": {
        const standby = n.config.failover === "none" ? 0 : 1;
        hourly += per * (1 + n.config.readReplicas + standby) * regions;
        monthly += n.config.storageGb * e.storageCostPerGbMonth * regions;
        break;
      }
      case "kv_store":
        hourly += per * n.config.nodes * n.config.replication * regions;
        break;
      case "stream":
        hourly += per * n.config.partitions * n.config.replication * regions;
        break;
      case "queue":
        hourly += per * n.config.partitions * regions;
        break;
      case "search_index":
      case "geo_index":
        hourly += per * n.config.shards * (1 + n.config.replicas) * regions;
        break;
      case "coordination": // its members, wherever they are
        hourly += per * n.config.members;
        break;
      default:
        hourly += per * n.config.nodes * regions;
    }
  }
  return hourly * e.hoursPerMonth + monthly;
}

// Where writes are kept and how much fits: every datastore a write can reach from the
// client must hold all of it (a relational database its provisioned storage, a
// key-value store its nodes), and object storage has no limit but bills per GB.
function storageOf(
  design: Design,
  problem: HldProblem,
  spec: SpecVersion,
): { gb: number | null; unlimited: boolean; copies: number } {
  const reached = new Set<string>();
  for (const r of problem.traffic.requests) {
    if (r.kind !== "write") continue;
    const client = design.nodes.find((n) => n.kind === "client");
    const todo = client === undefined ? [] : [client.id];
    const seen = new Set(todo);
    for (let id = todo.pop(); id !== undefined; id = todo.pop()) {
      reached.add(id);
      for (const e of design.edges)
        if (e.from === id && e.routes.includes(r.type) && !seen.has(e.to)) {
          seen.add(e.to);
          todo.push(e.to);
        }
    }
  }
  let gb: number | null = null;
  let unlimited = false;
  let copies = 0; // object storage keeps a full copy in each of its regions

  const fits = (x: number) => (gb = gb === null ? x : Math.min(gb, x));
  for (const n of design.nodes) {
    if (!reached.has(n.id)) continue;
    if (n.kind === "object_storage") {
      unlimited = true;
      copies = Math.max(copies, n.config.regions);
    }
    if (n.kind === "sql_db") fits(n.config.storageGb);
    if (n.kind === "kv_store")
      fits(n.config.nodes * spec.engine.kvStorageGbPerNode);
  }
  // Spec 2.1: a coordinator holds leases and blocks. Where it's the only store writes
  // reach, the data is kept there, and its cap is what fits (ADR-0052).
  const stores = design.nodes.filter(
    (n) =>
      reached.has(n.id) &&
      (n.kind === "object_storage" ||
        n.kind === "sql_db" ||
        n.kind === "kv_store"),
  );
  if (stores.length === 0)
    for (const n of design.nodes)
      if (reached.has(n.id) && n.kind === "coordination")
        fits(spec.features.coordination?.storageGb ?? 0);
  return { gb, unlimited, copies };
}

// 1 when the measure meets its target, falling linearly to 0 at twice the target
// (Q-P6-02). `over` is the measure as a multiple of what's allowed.
const targetScore = (over: number) => Math.max(0, Math.min(1, 2 - over));

// Every node before the nodes it sends to.
function topological(design: Design): string[] {
  const out = new Map<string, string[]>();
  for (const e of design.edges)
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const done = new Set<string>();
  const list: string[] = [];
  const visit = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    for (const next of out.get(id) ?? []) visit(next);
    list.push(id);
  };
  for (const n of design.nodes) visit(n.id);
  return list.reverse();
}

export function simulate(
  problem: HldProblem,
  design: Design,
): SimulationResult {
  const explanations: string[] = [];
  const empty = (why: string): SimulationResult => ({
    spec: design.spec,
    costPerMonth: 0,
    storageNeededGb: 0,
    storageGb: null,
    writesKept: false,
    scenarios: [],
    points: 0,
    baselinePassed: false,
    explanations: [why],
  });
  const spec = specVersion(design.spec);
  // Design.parse holds a design to published versions; one built by hand may not be.
  if (spec === null) return empty(`There's no spec version ${design.spec}.`);
  // Design.parse refuses a kind its version lacks; one built by hand may use one.
  const unknown = design.nodes.filter(
    (n) => spec.components[n.kind] === undefined,
  );
  if (unknown.length > 0)
    return empty(
      `${unknown.map((n) => n.id).join(", ")}: spec ${spec.version} has no ${[...new Set(unknown.map((n) => kindName(n.kind)))].join(" or ")}, so the design can't be simulated.`,
    );
  const allowed = new Set<ComponentKind>([
    "client",
    ...problem.allowedComponents,
  ]);
  const banned = design.nodes.filter((n) => !allowed.has(n.kind));
  if (banned.length > 0)
    return empty(
      `${banned.map((n) => n.id).join(", ")}: not allowed in this problem, so the design can't be simulated.`,
    );
  const requests = problem.traffic.requests;
  const known = new Set(requests.map((r) => r.type));
  for (const t of new Set(design.edges.flatMap((e) => e.routes)))
    if (!known.has(t))
      explanations.push(
        `"${t}" isn't one of this problem's request types: its routes are ignored.`,
      );

  const storage = storageOf(design, problem, spec);
  const t = problem.traffic;
  const storageNeededGb = t.storedGb + t.growthGbPerDay * t.horizonDays;
  const fixedCost =
    costPerMonth(design, spec) +
    storageNeededGb * spec.engine.objectStoragePerGbMonth * storage.copies;
  let storageScore = 1;
  const storageNotes: string[] = [];
  if (storage.gb !== null) {
    storageScore = targetScore(storageNeededGb / storage.gb);
    storageNotes.push(
      `Storage: ${fmt(storageNeededGb)} GB needed by day ${String(t.horizonDays)}; where writes are kept holds ${fmt(storage.gb)} GB.`,
    );
  } else if (!storage.unlimited && storageNeededGb > 0) {
    storageScore = 0;
    storageNotes.push(
      "Storage: no write reaches a database or store, so nothing is kept.",
    );
  }

  const sorted = topological(design);
  const backwards = [...sorted].reverse();
  const client = design.nodes.find((n) => n.kind === "client");
  const totalRps = requests.reduce((a, r) => a + r.rps, 0);
  const { lag, work, bytes, failFast, requires } = spec.features;
  const { gateway, fanout, hot, batch } = spec.features;
  // The nodes each request type's routes reach from the client (whatever is up: an
  // outage is availability, not a missing step), and their kinds.
  const reachedIds = new Map(
    requests.map((r) => {
      const todo = client === undefined ? [] : [client.id];
      const seen = new Set(todo);
      for (let id = todo.pop(); id !== undefined; id = todo.pop())
        for (const e of design.edges)
          if (e.from === id && e.routes.includes(r.type) && !seen.has(e.to)) {
            seen.add(e.to);
            todo.push(e.to);
          }
      if (client !== undefined) seen.delete(client.id);
      return [r.type, seen];
    }),
  );
  const kindOf = new Map(design.nodes.map((n) => [n.id, n.kind]));
  const reachedKinds = new Map(
    [...reachedIds].map(([type, ids]) => [
      type,
      new Set([...ids].map((id) => kindOf.get(id) ?? "client")),
    ]),
  );
  // ADR-0053: each external provider's pick, where the problem offers one.
  const picks = new Map(
    design.nodes.map((n) => [n.id, picked(problem, spec, n)] as const),
  );
  for (const p of picks.values()) if (p?.ok === false) explanations.push(p.why);
  const usable = (id: string) => picks.get(id)?.ok !== false;
  // Card payments: the dearest usable processor's fee per payment, against the
  // problem's target; it scores in every scenario, as the budget does.
  const feeTarget = problem.traffic.provider?.feeTargetUsd;
  const feeList = [...picks.values()].flatMap((p) =>
    p?.ok === true && p.card ? [p.perCall] : [],
  );
  const feePerPayment = feeList.length === 0 ? null : Math.max(...feeList);
  const feeScore =
    feeTarget === undefined ||
    feePerPayment === null ||
    feePerPayment <= feeTarget + EPS
      ? 1
      : targetScore(feePerPayment / feeTarget);
  // ADR-0051: what each request type requires and its routes never reach (an external
  // provider with no usable pick counts as not reached: it does no work).
  const missing = new Map(
    requests.map((r) => [
      r.type,
      requires === undefined
        ? []
        : (r.requires ?? []).filter(
            (k) =>
              ![...(reachedIds.get(r.type) ?? [])].some(
                (id) => kindOf.get(id) === k && usable(id),
              ),
          ),
    ]),
  );
  // The providers a type reaches that have no usable pick.
  const unpicked = (type: string) =>
    [...(reachedIds.get(type) ?? [])].filter((id) => !usable(id));
  // A node result's pick, only where the problem offers one.
  const providerOf = (id: string) => {
    const p = picks.get(id);
    return p === null || p === undefined
      ? {}
      : { provider: p.ok ? p.name : null };
  };
  // Spec 2.1: the gateways the client's requests reach hold its connections, shared
  // evenly (ADR-0052).
  const holders =
    gateway === undefined || t.connections === undefined
      ? []
      : design.nodes.filter(
          (n) =>
            n.kind === "connection_gateway" &&
            requests.some((r) => reachedIds.get(r.type)?.has(n.id) === true),
        );
  // [fanout]: where a request type's deliveries start: the first worker behind a queue
  // or stream on its path, or with none, its first app service.
  const viaAsync = (type: string) =>
    [...(reachedKinds.get(type) ?? [])].some(isAsync);
  const fedByAsync = (id: string, type: string) =>
    design.edges.some(
      (e) =>
        e.to === id &&
        e.routes.includes(type) &&
        isAsync(kindOf.get(e.from) ?? "client"),
    );
  // [batch] (ADR-0052): a worker writes to a store or coordinator in batches; an app
  // service's batch is an ID block, leased from a coordinator. Calls to a provider and
  // pushes stay one a request.
  const batchTo = (
    from: DesignNode,
    to: DesignNode,
    r: (typeof requests)[number],
  ) =>
    r.kind === "write" &&
    (from.kind === "app_service"
      ? to.kind === "coordination"
      : DATASTORES.has(to.kind) || to.kind === "stream")
      ? batchOf(from)
      : 1;
  // [fanout] (ADR-0052): a type that goes to many is served only when its path has
  // somewhere its deliveries start.
  const sends = new Map(
    requests.map((r) => [
      r.type,
      fanout === undefined ||
        r.fanout === undefined ||
        [...(reachedIds.get(r.type) ?? [])].some((id) => {
          const kind = kindOf.get(id);
          return (
            (kind === "worker" && fedByAsync(id, r.type)) ||
            (kind === "app_service" && !viaAsync(r.type))
          );
        }),
    ]),
  );
  const batchOf = (n: DesignNode) =>
    batch !== undefined && (n.kind === "worker" || n.kind === "app_service")
      ? (n.config.batch ?? 1)
      : 1;
  const secondsPerMonth = spec.engine.hoursPerMonth * 3600;
  // [lag]: a scenario's own load for a request type (a burst of uploads).
  const loadFor = (scenario: Scenario, type: string) =>
    lag === undefined
      ? scenario.load
      : (scenario.loads?.[type] ?? scenario.load);

  // One scenario's loads (`usage`, the baseline's per-call and egress cost, needs them
  // before anything is scored), then its result.
  const prepare = (scenario: Scenario) => {
    const stations = new Map(
      design.nodes.map((n) => [n.id, station(n, scenario, spec)]),
    );
    const at = (id: string) => stations.get(id) as Station; // every edge's ends exist
    const targets = new Map<string, Station[]>();
    for (const e of design.edges)
      for (const type of e.routes) {
        const key = `${e.from}\u0000${type}`;
        const list = targets.get(key) ?? [];
        if (!list.includes(at(e.to))) targets.set(key, [...list, at(e.to)]);
      }
    const out = (id: string, type: string) =>
      targets.get(`${id}\u0000${type}`) ?? [];
    const hit = (st: Station) => hitRate(st, problem, spec);
    const notes: string[] = [];
    // [lag]: each request type's arrivals at each node.
    const arrivals = new Map<string, Map<string, number>>();
    // [fanout]: the nodes where each request type's deliveries started.
    const fanned = new Map<string, Set<string>>();

    // Spec 2.1: the gateways' connections, at the scenario's load. Servers a failure
    // takes away send their share back to connect within the window: a reconnect
    // storm, on the problem's "connect" requests when it has them, else on the gateway.
    let storm = 0;
    for (const n of holders) {
      const st = at(n.id);
      st.conns = ((t.connections ?? 0) * scenario.load) / holders.length;
      const all = regionsOf(n) * ("nodes" in n.config ? n.config.nodes : 1);
      const left = st.up ? st.servers : 0;
      const rate =
        (st.conns * (all - left)) /
        all /
        (gateway?.reconnectWindowSeconds ?? 1);
      if (rate <= 0) continue;
      notes.push(
        `${n.id} loses ${pct((all - left) / all)} of its servers: ${fmt(rate)} reconnects a second for ${String(gateway?.reconnectWindowSeconds ?? 0)} seconds.`,
      );
      if (requests.some((r) => r.type === "connect")) storm += rate;
      else st.load += rate;
    }

    // Where a sender's request goes: the first cache that may answer it (another on the
    // same hop adds nothing), caches it merely passes through, the rest of its targets
    // (each called in turn), and the queues or streams it hands work to.
    const route = (id: string, type: string, cacheable: boolean) => {
      const next = out(id, type);
      const caches = next.filter((s) => isCache(s.node.kind));
      // A read-through cache first, so edge order never matters.
      const cache = cacheable
        ? (caches.find((c) => out(c.node.id, type).length > 0) ??
          caches[0] ??
          null)
        : null;
      return {
        cache,
        readThrough: cache !== null && out(cache.node.id, type).length > 0,
        hops: cacheable ? [] : caches,
        calls: next.filter(
          (s) => !isCache(s.node.kind) && !isAsync(s.node.kind),
        ),
        async: next.filter((s) => isAsync(s.node.kind)),
      };
    };

    // Loads, in topological order: what reaches each node and what it passes on.
    for (const r of requests) {
      const arriving = new Map<string, number>();
      arrivals.set(r.type, arriving);
      if (client !== undefined)
        arriving.set(
          client.id,
          r.rps * loadFor(scenario, r.type) +
            (r.type === "connect" ? storm : 0),
        );
      // [fanout]: what hasn't fanned out yet, of what arrives at each node.
      const fan = fanout === undefined ? undefined : r.fanout;
      const before = new Map<string, number>();
      if (client !== undefined && fan !== undefined)
        before.set(client.id, arriving.get(client.id) ?? 0);
      const here = new Set<string>();
      fanned.set(r.type, here);
      for (const id of sorted) {
        const f = arriving.get(id) ?? 0;
        if (f <= 0) continue;
        const st = at(id);
        const kind = st.node.kind;
        // Spec 2.1: a geo index's nearby query asks the shards of a few cells.
        const visits =
          kind === "geo_index" && r.kind === "read" ? st.shards : 1;
        if (r.kind === "write" && SPLIT.has(kind)) st.writeLoad += f;
        // [work]: a worker spends the request's work units on it.
        else if (kind === "worker" && work !== undefined)
          st.load += f * (r.work ?? 1);
        else if (kind !== "client") st.load += f * visits;
        // [hot]: the busiest server takes its even share, or a hot type's share of its
        // partition. Every copy applies every write; a read is answered by one of its
        // copies (each region's, a geo shard's replicas).
        if (hot !== undefined && PARTITIONED.has(kind)) {
          const write = r.kind === "write" && SPLIT.has(kind);
          const servers = write ? st.writeServers : st.servers;
          const unit =
            r.kind === "write"
              ? 1
              : regionsOf(st.node) * (kind === "geo_index" ? st.redundancy : 1);
          const added = f * visits;
          const busiest =
            servers > 0
              ? Math.max(added / servers, (f * (r.hotShare ?? 0)) / unit)
              : 0;
          if (write) st.writeBusiest += busiest;
          else {
            st.busiest += busiest;
            if ((f * (r.hotShare ?? 0)) / unit > added / servers)
              st.hotCopies = Math.max(st.hotCopies, unit);
          }
        }
        if (bytes !== undefined && r.payloadKb !== undefined)
          st.mbps += f * r.payloadKb * 0.008; // KB to megabits
        // A down cache is passed by; anything else that's down stops the request.
        if (!st.up && !isCache(kind)) continue;
        let scale = isCache(kind) && r.cacheable ? 1 - hit(st) : 1;
        // [fanout]: from where deliveries start, each request is `mean` of them.
        let early = fan === undefined ? 0 : (before.get(id) ?? 0) / f;
        if (
          fan !== undefined &&
          early > 0 &&
          ((kind === "worker" && fedByAsync(id, r.type)) ||
            (kind === "app_service" && !viaAsync(r.type)))
        ) {
          here.add(id);
          scale *= early * fan.mean + (1 - early);
          early = 0;
        }
        const send = (to: Station, share: number) => {
          const rps = (f * scale * share) / batchTo(st.node, to.node, r);
          arriving.set(to.node.id, (arriving.get(to.node.id) ?? 0) + rps);
          if (early > 0)
            before.set(to.node.id, (before.get(to.node.id) ?? 0) + rps * early);
        };
        if (isAsync(kind)) {
          for (const consumer of out(id, r.type)) send(consumer, 1);
          continue;
        }
        const rt = route(id, r.type, r.cacheable);
        const misses =
          rt.cache === null || rt.readThrough ? 1 : 1 - hit(rt.cache);
        if (rt.cache !== null) send(rt.cache, 1);
        for (const s of rt.hops) send(s, 1);
        for (const s of rt.calls) send(s, misses);
        for (const s of rt.async) send(s, 1);
      }
    }

    // What the month costs beyond the nodes, from a normal day's arrivals (spec 2.0):
    // the provider's calls at its price, and [bytes] each read's payload, billed by what
    // hands it to the client (a CDN at its rate, anything else at the origin's).
    const usage = () => {
      const arriving = (type: string, id: string) =>
        arrivals.get(type)?.get(id) ?? 0;
      let provider = 0;
      let fees = 0;
      for (const n of design.nodes) {
        if (n.kind !== "external_api") continue;
        // ADR-0053: the pick's price, and nothing for a provider that does no work.
        const p = picks.get(n.id);
        const perCall =
          p === null || p === undefined
            ? (problem.traffic.providerCostPerCall ?? 0)
            : p.ok
              ? p.perCall
              : 0;
        if (p?.ok === true) provider += p.monthly;
        let calls = 0;
        for (const r of requests)
          if (r.billed !== false) calls += arriving(r.type, n.id);
        // A card fee is paid apart from the infrastructure budget.
        if (p?.ok === true && p.card) fees += calls * secondsPerMonth * perCall;
        else provider += calls * secondsPerMonth * perCall;
      }
      let egress = 0;
      if (bytes !== undefined && client !== undefined)
        for (const r of requests) {
          if (r.kind !== "read" || r.payloadKb === undefined) continue;
          const rt = route(client.id, r.type, r.cacheable);
          if (rt.calls.length === 0 && rt.cache === null) continue;
          const cdn = rt.cache?.node.kind === "cdn" ? rt.cache : null;
          const viaCdn = cdn === null ? 0 : rt.readThrough ? 1 : hit(cdn);
          const gb =
            (arriving(r.type, client.id) * r.payloadKb * secondsPerMonth) / 1e6;
          egress +=
            gb *
            (viaCdn * bytes.cdnEgressPerGb +
              (1 - viaCdn) * bytes.originEgressPerGb);
        }
      return { provider, egress, fees };
    };

    // A component's own p50, p99, availability and utilization for one class of
    // request. Up while any copy is; a search query needs every shard.
    const own = (st: Station, write: boolean) => {
      const node = st.node;
      const stats = statsOf(spec, node.kind);
      const primary = write && SPLIT.has(node.kind);
      const servers = primary ? st.writeServers : st.servers;
      if (!st.up || servers <= 0)
        return {
          p50: Infinity,
          p99: Infinity,
          availability: 0,
          utilization: Infinity,
          hot: false,
        };
      const capacity =
        node.kind === "external_api"
          ? (problem.traffic.providerRps ?? 0)
          : node.kind === "coordination" && primary
            ? // More members, slower commits.
              ((stats.writeCapacity ?? stats.capacity) * 3) /
              node.config.members
            : primary
              ? (stats.writeCapacity ?? stats.capacity)
              : stats.capacity;
      // [bytes]: bytes fill a node as requests do; the larger counts.
      let load =
        bytes !== undefined && stats.bandwidthMbps !== undefined && !primary
          ? Math.max(st.load, (st.mbps * stats.capacity) / stats.bandwidthMbps)
          : primary
            ? st.writeLoad
            : st.load;
      // Spec 2.1: a gateway fills on connections as on messages.
      if (stats.connectionCapacity !== undefined)
        load = Math.max(
          load,
          (st.conns * stats.capacity) / stats.connectionCapacity,
        );
      let base = primary
        ? (stats.writeLatencyMs ?? stats.latencyMs)
        : stats.latencyMs;
      // A coordinator's commit crosses its zones and regions.
      const c = spec.features.coordination;
      if (node.kind === "coordination" && primary && c !== undefined)
        base +=
          (node.config.zones > 1 ? c.crossZoneMs : 0) +
          (node.config.regions > 1 ? c.crossRegionMs : 0);
      let lat = stationLatency(servers, capacity, load, base);
      let served = lat.utilization > 1 ? 1 / lat.utilization : 1;
      // [hot]: its busiest server, on its own, when a hot type makes it busier than the
      // rest; what's beyond its capacity isn't served.
      const busiest = primary ? st.writeBusiest : st.busiest;
      let hotSpot = false;
      if (
        hot !== undefined &&
        load > 0 &&
        busiest > load / servers + EPS &&
        busiest / capacity > lat.utilization
      ) {
        hotSpot = true;
        lat = stationLatency(1, capacity, busiest, base);
        const copies = primary ? 1 : st.hotCopies;
        served = Math.min(
          served,
          Math.max(0, 1 - (copies * Math.max(0, busiest - capacity)) / load),
        );
      }
      // [batch], spec 2.1: a batching worker waits to fill a batch, at most the spec's
      // wait (half of it at the median).
      const size = node.kind === "worker" ? batchOf(node) : 1;
      if (size > 1 && batch !== undefined) {
        const per =
          requests.reduce(
            (a, r) =>
              a +
              (r.kind === "write"
                ? (arrivals.get(r.type)?.get(node.id) ?? 0)
                : 0),
            0,
          ) / servers;
        const wait =
          1000 *
          Math.min(batch.maxWaitSeconds, per > 0 ? size / per : Infinity);
        lat = { ...lat, p50: lat.p50 + wait / 2, p99: lat.p99 + wait };
      }
      const copies = primary ? st.writeRedundancy : st.redundancy;
      // ADR-0053: a picked provider's published SLA, else the sheet's estimate.
      const pick = picks.get(node.id);
      const availability =
        (pick?.ok === true ? pick.availability : null) ?? stats.availability;
      // A coordinator is up while a majority of all its members is.
      const up =
        node.kind === "coordination"
          ? quorumUp(st.servers, majority(node.config.members), availability)
          : (1 - (1 - availability) ** copies) **
            (primary && node.kind === "geo_index" ? 1 : st.shards);
      return {
        ...lat,
        availability: up * (1 - st.lostShare) * served,
        hot: hotSpot,
      };
    };
    // [bytes]: whether a node's payload fills it more than its requests do.
    // Spec 2.1: whether a gateway's connections fill it more than its messages do.
    const filledByConnections = (st: Station) => {
      const stats = statsOf(spec, st.node.kind);
      return (
        stats.connectionCapacity !== undefined &&
        (st.conns * stats.capacity) / stats.connectionCapacity > st.load
      );
    };
    const filledByBytes = (st: Station) => {
      const stats = statsOf(spec, st.node.kind);
      return (
        bytes !== undefined &&
        stats.bandwidthMbps !== undefined &&
        (st.mbps * stats.capacity) / stats.bandwidthMbps > st.load
      );
    };
    // A cache costs its own latency; one that's down is passed by at no cost.
    const cacheSelf = (st: Station): Rest => {
      if (!st.up) return NOTHING;
      const o = own(st, false);
      return {
        ...NOTHING,
        p50: o.p50,
        p99: o.p99,
        overloaded: o.utilization >= 1,
        util: o.utilization,
      };
    };

    // Where the work is done: a datastore for any request; a worker for a write handed
    // to it through a queue or stream; a third party, which does what it's called for.
    const doesWork = (st: Station, r: (typeof requests)[number]) =>
      DATASTORES.has(st.node.kind) ||
      st.node.kind === "external_api" ||
      // Spec 2.1: a gateway delivers what's pushed.
      (st.node.kind === "connection_gateway" && r.push === true) ||
      (st.node.kind === "worker" &&
        r.kind === "write" &&
        design.edges.some(
          (e) =>
            e.to === st.node.id &&
            e.routes.includes(r.type) &&
            isAsync(at(e.from).node.kind),
        ));

    // The rest of a request's path from a node that sends it on (null: it sends it
    // nowhere): the cache that may answer it, its other targets called in turn, the
    // caches it passes through, and the queues or streams it hands work to.
    const sender = (
      id: string,
      r: (typeof requests)[number],
      next: (s: Station) => Rest,
    ): Rest | null => {
      const rt = route(id, r.type, r.cacheable);
      const onward = (s: Station) => out(s.node.id, r.type).length > 0;
      const passes = rt.hops.filter(onward);
      if (
        rt.cache === null &&
        rt.calls.length === 0 &&
        rt.async.length === 0 &&
        passes.length === 0
      )
        return null;
      const calls =
        rt.calls.length === 0 ? null : rt.calls.map(next).reduce(seq, NOTHING);
      let path: Rest;
      if (rt.cache === null) path = calls ?? NOTHING;
      else if (rt.readThrough) path = seq(next(rt.cache), calls ?? NOTHING);
      // Cache-aside: hits stop at the cache, misses go to the other targets.
      else path = seq(cacheSelf(rt.cache), mix(hit(rt.cache), calls ?? DEAD));
      for (const s of rt.hops)
        // A cache a write merely touches (to invalidate it) is a side call.
        path = seq(
          path,
          onward(s) ? next(s) : { ...next(s), served: 1, reaches: true },
        );
      for (const s of rt.async) path = seq(path, next(s));
      return path;
    };

    // [lag]: what a queue or stream's backlog leaves of a request type's asynchronous
    // work. Normally its lag is the consumers' p99. When they can't keep up (or the
    // provider behind them is down), the excess waits for the scenario's minutes and
    // drains afterwards at the spare capacity they have on a normal day. It's done late,
    // not lost, while the worst wait is within the completion target and the
    // retention; past either, the share past it isn't served. Transient failures behind
    // a durable queue are retried, so only the backlog counts.
    const backlog = (
      id: string,
      r: (typeof requests)[number],
      consumers: Rest,
      normal: { util: number; arrival: number } | undefined,
      target: number,
      minutesDefault: number,
    ) => {
      const node = at(id).node;
      const arrival = arrivals.get(r.type)?.get(id) ?? 0;
      const spike = (scenario.minutes ?? minutesDefault) * 60;
      const retention =
        node.kind === "queue" || node.kind === "stream"
          ? // Design.parse requires a 2.0 stream's retention; one built by hand
            // without it keeps the most it may: a week.
            (node.config.retentionHours ?? 168) * 3600
          : Infinity;
      const limit = Math.min(target, retention);
      let held = 0;
      let worst = consumers.p99 / 1000;
      if (consumers.util >= 1) {
        const rate = Number.isFinite(consumers.util)
          ? arrival / consumers.util
          : 0;
        held = (arrival - rate) * spike;
        const day = normal ?? { util: consumers.util, arrival };
        const drain = day.util < 1 ? day.arrival * (1 / day.util - 1) : 0;
        worst = spike + (drain > 0 ? held / drain : Infinity);
      }
      const late = worst <= limit ? 0 : 1 - limit / worst;
      if (held > 0)
        notes.push(
          `${id} holds ${fmt(held)} "${r.type}" requests at the worst and ${Number.isFinite(worst) ? `has done them ${duration(worst)} later` : "never catches up"} (target ${duration(target)}${retention < Infinity ? `, retention ${duration(retention)}` : ""}).`,
        );
      if (late > 0)
        notes.push(
          `${pct(late)} of "${r.type}" isn't done in time: ${worst > retention ? "the backlog outlives the retention" : "the backlog drains too slowly"}.`,
        );
      return { worst, late };
    };

    const result = (
      cost: number,
      normalLag: Map<string, { util: number; arrival: number }> | null,
    ) => {
      // [lag]: each async node's consumer path for each type, as a normal day sees it,
      // and each type's share done too late.
      const lagSeen = new Map<string, { util: number; arrival: number }>();
      const lateShares: number[] = [];
      // Each node's rest of the path per request type, from the sinks back.
      const types: TypeResult[] = requests.map((r) => {
        const write = r.kind === "write";
        const target = lag === undefined ? undefined : r.completionSeconds;
        let worstLag = 0;
        let onTime = 1;
        const rest = new Map<string, Rest>();
        const next = (s: Station) => rest.get(s.node.id) ?? DEAD;
        for (const id of backwards) {
          const st = at(id);
          const kind = st.node.kind;
          let onward: Rest;
          if (isAsync(kind)) {
            // A write ends here; its consumers' work must still get done, but their time
            // isn't the caller's. A read can't be answered later.
            const consumers = out(id, r.type);
            if (consumers.length === 0 || !write) onward = DEAD;
            else {
              const path = consumers.map(next).reduce(seq, NOTHING);
              if (target === undefined || lag === undefined)
                onward = { ...path, p50: 0, p99: 0 };
              else {
                const key = `${r.type}\u0000${id}`;
                const arrival = arrivals.get(r.type)?.get(id) ?? 0;
                lagSeen.set(key, { util: path.util, arrival });
                const { worst, late } = backlog(
                  id,
                  r,
                  path,
                  normalLag?.get(key),
                  target,
                  lag.defaultScenarioMinutes,
                );
                if (arrival > 0) {
                  worstLag = Math.max(worstLag, worst);
                  onTime *= 1 - late;
                }
                onward = path.reaches ? { ...NOTHING, served: 1 - late } : DEAD;
              }
            }
          } else {
            const path = sender(id, r, next);
            if (isCache(kind)) {
              // Read-through: it answers hits and asks its own targets the rest; anything
              // else passes through it.
              const origin = path ?? DEAD;
              onward = r.cacheable ? mix(hit(st), origin) : origin;
            } else if (path !== null) onward = path;
            // Sending nowhere, the request is done only where the work is done.
            else onward = doesWork(st, r) ? NOTHING : DEAD;
          }
          // [batch]: an app service hands out a block it holds, asking onward only for
          // the next block: like a cache's misses, that shows when it's often enough.
          const block =
            kind === "app_service" &&
            r.kind === "write" &&
            out(id, r.type).every((x) => x.node.kind === "coordination")
              ? batchOf(st.node)
              : 1;
          if (block > 1)
            onward = {
              ...onward,
              p50: 1 / block > 0.5 + EPS ? onward.p50 : 0,
              p99: 1 / block > 0.01 + EPS ? onward.p99 : 0,
            };
          // [fanout]: from where its deliveries start, the rest of the path is waited
          // for once per round of them sent at once.
          const fan = r.fanout;
          if (
            fanout !== undefined &&
            fan !== undefined &&
            fanned.get(r.type)?.has(id) === true
          )
            onward = {
              ...onward,
              p50: onward.p50 * Math.ceil(fan.mean / fanout.parallelism),
              p99: onward.p99 * Math.ceil(fan.p99 / fanout.parallelism),
            };
          if (kind === "client") {
            rest.set(id, onward);
            continue;
          }
          const self = isCache(kind)
            ? cacheSelf(st)
            : (() => {
                const o = own(st, write);
                return {
                  p50: o.p50,
                  p99: o.p99,
                  served: o.availability,
                  overloaded:
                    Number.isFinite(o.utilization) && o.utilization >= 1,
                  reaches: true,
                  util: o.utilization,
                };
              })();
          rest.set(id, seq(self, onward));
        }
        if (target !== undefined) lateShares.push(1 - onTime);
        const s = client === undefined ? DEAD : next(at(client.id));
        const routed =
          client !== undefined && out(client.id, r.type).length > 0;
        const left = missing.get(r.type) ?? [];
        const unsent = !sends.get(r.type);
        const served = s.reaches && left.length === 0 && !unsent ? s.served : 0;
        if (!routed)
          notes.push(
            `"${r.type}" requests go nowhere: the client doesn't send them.`,
          );
        else if (!s.reaches)
          notes.push(
            `"${r.type}" requests never reach a datastore (or, for a write, a worker behind a queue), so none is served.`,
          );
        else if (left.includes("external_api") && unpicked(r.type).length > 0)
          notes.push(
            `"${r.type}" requests reach ${unpicked(r.type).join(", ")}, but it has no provider it can use, so none is served.`,
          );
        else if (left.length > 0)
          notes.push(
            `"${r.type}" requests never reach ${left.map(aKind).join(" or ")}, which does their work, so none is served.`,
          );
        else if (unsent)
          notes.push(
            `"${r.type}" requests each go to many, but nothing sends them: route them through an app service, or a worker behind a queue, so none is served.`,
          );
        return {
          type: r.type,
          p50Ms: served > 0 ? finite(s.p50) : null,
          p99Ms: served > 0 ? finite(s.p99) : null,
          availability: served,
          overloaded: s.overloaded,
          ...(target === undefined
            ? {}
            : {
                lagSeconds: Number.isFinite(worstLag) ? r1(worstLag) : null,
              }),
        };
      });

      const nodes: NodeResult[] = design.nodes
        .filter((n) => n.kind !== "client")
        .map((n) => {
          const st = at(n.id);
          const reads = own(st, false);
          const writes =
            SPLIT.has(n.kind) && st.writeLoad > 0 ? own(st, true) : reads;
          // A primary lost with no standby takes writes, not the node, away.
          const stopped = n.kind === "sql_db" && st.up && st.writeServers <= 0;
          const utilization = Math.max(
            reads.utilization,
            stopped ? 0 : writes.utilization,
          );
          if (!st.up)
            notes.push(
              n.kind === "coordination"
                ? `${n.id} has lost its quorum: ${String(st.servers)} of ${String(n.config.members)} members left, and it needs ${String(majority(n.config.members))}.`
                : `${n.id} is down in this scenario.`,
            );
          else if (stopped)
            notes.push(
              `${n.id} has lost its primary and has no standby: writes stop.`,
            );
          else if (utilization >= 1)
            notes.push(
              reads.hot || writes.hot
                ? `${n.id}'s busiest partition is overloaded: a hot key puts ${pct(utilization)} of one server's capacity on it while the rest have room.`
                : filledByConnections(st)
                  ? `${n.id} is overloaded: ${fmt(st.conns)} connections is ${pct(utilization)} of what its ${String(st.servers)} server(s) hold.`
                  : filledByBytes(st)
                    ? `${n.id} is overloaded: ${fmt(st.mbps)} Mbps is ${pct(utilization)} of the bandwidth its ${String(st.servers)} server(s) have.`
                    : `${n.id} is overloaded: ${fmt(st.load + st.writeLoad)} requests/s is ${pct(utilization)} of what its ${String(st.servers)} server(s) handle.`,
            );
          else if (utilization > 0.8)
            notes.push(
              `${n.id} runs hot at ${pct(utilization)}${filledByBytes(st) ? " of its bandwidth" : ""}: waits grow fast past 80%.`,
            );
          if (st.lostShare > 0)
            notes.push(
              `${n.id} loses ${pct(st.lostShare)} of its data: it keeps one copy.`,
            );
          if (isCache(n.kind) && st.up && st.load > 0)
            notes.push(`${n.id} answers ${pct(hit(st))} of the reads it may.`);
          if (
            isAsync(n.kind) &&
            st.load > 0 &&
            !design.edges.some((e) => e.from === n.id)
          )
            notes.push(
              `${n.id} has no consumer: nothing does the work it holds.`,
            );
          return {
            id: n.id,
            kind: n.kind,
            up: st.up,
            servers: st.servers,
            loadRps: r1(st.load + st.writeLoad),
            utilization: st.up ? Math.round(utilization * 100) / 100 : null,
            p50Ms: finite(Math.max(reads.p50, stopped ? 0 : writes.p50)),
            p99Ms: finite(Math.max(reads.p99, stopped ? 0 : writes.p99)),
            ...(reads.hot || writes.hot ? { hot: true as const } : {}),
            ...providerOf(n.id),
          };
        });

      const availability =
        types.reduce(
          (a, x, i) => a + x.availability * (requests[i]?.rps ?? 0),
          0,
        ) / totalRps;
      // Spec 2.0: a type the provider's outage refuses entirely has failed fast; its
      // availability counts. Our own components' outages still hang (as in 1.0).
      const refused = (type: string) =>
        design.nodes.some(
          (n) =>
            n.kind === "external_api" &&
            !at(n.id).up &&
            (arrivals.get(type)?.get(n.id) ?? 0) > 0,
        );
      const timed =
        failFast === undefined
          ? types
          : types.filter((x) => x.availability > 0 || !refused(x.type));
      const unbounded =
        timed.length === 0 || timed.some((x) => x.p99Ms === null);
      const p99Ms = unbounded
        ? null
        : Math.max(...timed.map((x) => x.p99Ms ?? 0));
      const { p99Ms: p99Target, availability: availabilityTarget } =
        scenario.targets;
      // [lag]: work done too late misses the availability target on its own, however
      // small its share of the traffic (a transcode among a million views).
      const scores = [
        p99Ms === null ? 0 : targetScore(p99Ms / p99Target),
        Math.min(
          targetScore((1 - availability) / (1 - availabilityTarget)),
          ...lateShares.map((late) =>
            targetScore(late / (1 - availabilityTarget)),
          ),
        ),
        targetScore(cost / problem.budgetPerMonth),
        storageScore,
        ...(feeTarget === undefined ? [] : [feeScore]),
      ];
      for (const x of types)
        notes.push(
          `"${x.type}": p99 ${x.p99Ms === null ? "unbounded" : `${String(x.p99Ms)} ms`} (target ${String(p99Target)} ms), ${pct(x.availability)} served.`,
        );
      // A scenario that serves nothing earns nothing, however cheap.
      const score =
        availability === 0
          ? 0
          : scores.reduce((a, s) => a + s, 0) / scores.length;
      return {
        lagSeen,
        result: {
          id: scenario.id,
          name: scenario.name,
          weight: scenario.weight,
          score: Math.round(score * 1000) / 1000,
          targetsMet: availability > 0 && scores.every((s) => s === 1),
          p99Ms,
          availability,
          types,
          nodes,
          explanations: notes,
        } satisfies ScenarioResult,
      };
    };
    return { usage, result };
  };

  // The baseline first: its loads set the month's usage cost, and [lag] drains every
  // other scenario's backlog at the spare capacity it shows.
  const prepared = problem.scenarios.map(prepare);
  const baselineAt = problem.scenarios.findIndex((s) => s.id === "baseline");
  const usage = prepared[baselineAt]?.usage() ?? {
    provider: 0,
    egress: 0,
    fees: 0,
  };
  const cost = fixedCost + usage.provider + usage.egress;
  explanations.push(
    `Cost: $${fmt(cost)} a month, against a budget of $${fmt(problem.budgetPerMonth)}.`,
  );
  if (usage.provider > 0 || usage.egress > 0)
    explanations.push(
      `Of which $${fmt(usage.provider)} is the provider's calls and $${fmt(usage.egress)} is bytes served.`,
    );
  // ADR-0053: each pick named, with what it charges.
  for (const n of design.nodes) {
    const label = pickLabel(problem, spec, n);
    if (label !== null) explanations.push(`${n.id}: ${label}.`);
  }
  const payer = [...picks.values()].find(
    (p) => p?.ok === true && p.card && p.perCall === feePerPayment,
  );
  if (feeTarget !== undefined && feePerPayment !== null && payer?.ok === true)
    explanations.push(
      `Fees per payment: $${feePerPayment.toFixed(2)} at ${payer.name}, ${feePerPayment > feeTarget + EPS ? "over the target" : "against a target"} of $${feeTarget.toFixed(2)}. $${fmt(usage.fees)} a month, paid apart from the infrastructure budget.`,
    );
  explanations.push(...storageNotes);
  const normal = prepared[baselineAt]?.result(cost, null);
  const scenarios = prepared.map((p, i) =>
    i === baselineAt && normal !== undefined
      ? normal.result
      : p.result(cost, normal?.lagSeen ?? null).result,
  );

  const totalWeight = scenarios.reduce((a, s) => a + s.weight, 0);
  const points =
    (SIMULATION_POINTS *
      scenarios.reduce((a, s) => a + s.weight * s.score, 0)) /
    totalWeight;
  return {
    spec: spec.version,
    costPerMonth: Math.round(cost * 100) / 100,
    storageNeededGb,
    storageGb: storage.gb,
    writesKept:
      storage.gb !== null || storage.unlimited || storageNeededGb === 0,
    scenarios,
    points: Math.round(points * 10) / 10,
    baselinePassed:
      scenarios.find((s) => s.id === "baseline")?.targetsMet === true,
    explanations,
    ...(problem.traffic.provider === undefined
      ? {}
      : { providerCostPerMonth: Math.round(usage.provider * 100) / 100 }),
    ...(feeTarget === undefined
      ? {}
      : {
          fees: {
            perPayment: feePerPayment,
            target: feeTarget,
            perMonth: Math.round(usage.fees * 100) / 100,
          },
        }),
  };
}
