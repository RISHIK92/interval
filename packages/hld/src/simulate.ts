import type { ComponentKind } from "./catalog";
import type { Design, DesignNode } from "./design";
import type { HldProblem, Scenario } from "./problem";
import { type SpecVersion, specVersion } from "./spec";

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

export const SIMULATION_POINTS = 60; // §6.4

const DATASTORES = new Set<ComponentKind>([
  "sql_db",
  "kv_store",
  "object_storage",
  "search_index",
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
};
export type TypeResult = {
  type: string;
  p50Ms: number | null; // null: unbounded, or nothing served
  p99Ms: number | null;
  availability: number; // the share served
  overloaded: boolean;
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
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (x: number) => Math.round(x).toLocaleString("en-US");
const finite = (x: number) => (Number.isFinite(x) ? r1(x) : null);

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
  };
  // Every region is active: a second one doubles capacity (and cost).
  switch (node.kind) {
    case "client":
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
    default: // app_service, cache, worker
      st.servers = node.config.nodes * regions;
      st.redundancy = st.servers;
  }
  if (node.kind !== "sql_db") {
    st.writeServers = st.servers;
    st.writeRedundancy = st.redundancy;
  }

  const failure = scenario.failure;
  if (failure === undefined || node.kind === "client") return st;
  const oneCopy =
    (node.kind === "kv_store" || node.kind === "stream") && st.redundancy === 1;
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
type Rest = {
  p50: number;
  p99: number;
  served: number;
  overloaded: boolean;
  reaches: boolean;
};
const NOTHING: Rest = {
  p50: 0,
  p99: 0,
  served: 1,
  overloaded: false,
  reaches: true,
};
const DEAD: Rest = { ...NOTHING, served: 0, reaches: false };
const seq = (a: Rest, b: Rest): Rest => ({
  p50: a.p50 + b.p50,
  p99: a.p99 + b.p99,
  served: a.served * b.served,
  overloaded: a.overloaded || b.overloaded,
  reaches: a.reaches && b.reaches,
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
      }
    : DEAD;

function costPerMonth(design: Design, spec: SpecVersion): number {
  const e = spec.engine;
  let hourly = 0;
  let monthly = 0;
  for (const n of design.nodes) {
    const per = spec.components[n.kind].costPerNodeHour;
    const regions = regionsOf(n);
    switch (n.kind) {
      case "client":
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
        hourly += per * n.config.shards * (1 + n.config.replicas) * regions;
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
  const cost =
    costPerMonth(design, spec) +
    storageNeededGb * spec.engine.objectStoragePerGbMonth * storage.copies;
  explanations.push(
    `Cost: $${fmt(cost)} a month, against a budget of $${fmt(problem.budgetPerMonth)}.`,
  );
  let storageScore = 1;
  if (storage.gb !== null) {
    storageScore = targetScore(storageNeededGb / storage.gb);
    explanations.push(
      `Storage: ${fmt(storageNeededGb)} GB needed by day ${String(t.horizonDays)}; where writes are kept holds ${fmt(storage.gb)} GB.`,
    );
  } else if (!storage.unlimited && storageNeededGb > 0) {
    storageScore = 0;
    explanations.push(
      "Storage: no write reaches a database or store, so nothing is kept.",
    );
  }

  const sorted = topological(design);
  const backwards = [...sorted].reverse();
  const client = design.nodes.find((n) => n.kind === "client");
  const totalRps = requests.reduce((a, r) => a + r.rps, 0);

  const scenarios = problem.scenarios.map((scenario): ScenarioResult => {
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
      const send = (st: Station, rps: number) =>
        arriving.set(st.node.id, (arriving.get(st.node.id) ?? 0) + rps);
      if (client !== undefined) arriving.set(client.id, r.rps * scenario.load);
      for (const id of sorted) {
        const f = arriving.get(id) ?? 0;
        if (f <= 0) continue;
        const st = at(id);
        const kind = st.node.kind;
        if (r.kind === "write" && kind === "sql_db") st.writeLoad += f;
        else if (kind !== "client") st.load += f;
        // A down cache is passed by; anything else that's down stops the request.
        if (!st.up && !isCache(kind)) continue;
        const onward = isCache(kind) && r.cacheable ? f * (1 - hit(st)) : f;
        if (isAsync(kind)) {
          for (const consumer of out(id, r.type)) send(consumer, onward);
          continue;
        }
        const rt = route(id, r.type, r.cacheable);
        const misses =
          rt.cache === null || rt.readThrough ? 1 : 1 - hit(rt.cache);
        if (rt.cache !== null) send(rt.cache, onward);
        for (const s of rt.hops) send(s, onward);
        for (const s of rt.calls) send(s, onward * misses);
        for (const s of rt.async) send(s, onward);
      }
    }

    // A component's own p50, p99, availability and utilization for one class of
    // request. Up while any copy is; a search query needs every shard.
    const own = (st: Station, write: boolean) => {
      const stats = spec.components[st.node.kind];
      const primary = write && st.node.kind === "sql_db";
      const servers = primary ? st.writeServers : st.servers;
      if (!st.up || servers <= 0)
        return {
          p50: Infinity,
          p99: Infinity,
          availability: 0,
          utilization: Infinity,
        };
      const lat = stationLatency(
        servers,
        primary ? (stats.writeCapacity ?? stats.capacity) : stats.capacity,
        primary ? st.writeLoad : st.load,
        primary ? (stats.writeLatencyMs ?? stats.latencyMs) : stats.latencyMs,
      );
      const copies = primary ? st.writeRedundancy : st.redundancy;
      const up = (1 - (1 - stats.availability) ** copies) ** st.shards;
      const served = lat.utilization > 1 ? 1 / lat.utilization : 1;
      return { ...lat, availability: up * (1 - st.lostShare) * served };
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
      };
    };

    // Where the work is done: a datastore for any request; a worker for a write handed
    // to it through a queue or stream.
    const doesWork = (st: Station, r: (typeof requests)[number]) =>
      DATASTORES.has(st.node.kind) ||
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

    // Each node's rest of the path per request type, from the sinks back.
    const types: TypeResult[] = requests.map((r) => {
      const write = r.kind === "write";
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
          onward =
            consumers.length === 0 || !write
              ? DEAD
              : {
                  ...consumers.map(next).reduce(seq, NOTHING),
                  p50: 0,
                  p99: 0,
                };
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
              };
            })();
        rest.set(id, seq(self, onward));
      }
      const s = client === undefined ? DEAD : next(at(client.id));
      const routed = client !== undefined && out(client.id, r.type).length > 0;
      const served = s.reaches ? s.served : 0;
      if (!routed)
        notes.push(
          `"${r.type}" requests go nowhere: the client doesn't send them.`,
        );
      else if (!s.reaches)
        notes.push(
          `"${r.type}" requests never reach a datastore (or, for a write, a worker behind a queue), so none is served.`,
        );
      return {
        type: r.type,
        p50Ms: served > 0 ? finite(s.p50) : null,
        p99Ms: served > 0 ? finite(s.p99) : null,
        availability: served,
        overloaded: s.overloaded,
      };
    });

    const nodes: NodeResult[] = design.nodes
      .filter((n) => n.kind !== "client")
      .map((n) => {
        const st = at(n.id);
        const reads = own(st, false);
        const writes =
          n.kind === "sql_db" && st.writeLoad > 0 ? own(st, true) : reads;
        // A primary lost with no standby takes writes, not the node, away.
        const stopped = n.kind === "sql_db" && st.up && st.writeServers <= 0;
        const utilization = Math.max(
          reads.utilization,
          stopped ? 0 : writes.utilization,
        );
        if (!st.up) notes.push(`${n.id} is down in this scenario.`);
        else if (stopped)
          notes.push(
            `${n.id} has lost its primary and has no standby: writes stop.`,
          );
        else if (utilization >= 1)
          notes.push(
            `${n.id} is overloaded: ${fmt(st.load + st.writeLoad)} requests/s is ${pct(utilization)} of what its ${String(st.servers)} server(s) handle.`,
          );
        else if (utilization > 0.8)
          notes.push(
            `${n.id} runs hot at ${pct(utilization)}: waits grow fast past 80%.`,
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
        };
      });

    const availability =
      types.reduce(
        (a, x, i) => a + x.availability * (requests[i]?.rps ?? 0),
        0,
      ) / totalRps;
    const unbounded = types.some((x) => x.p99Ms === null);
    const p99Ms = unbounded
      ? null
      : Math.max(...types.map((x) => x.p99Ms ?? 0));
    const { p99Ms: p99Target, availability: availabilityTarget } =
      scenario.targets;
    const scores = [
      p99Ms === null ? 0 : targetScore(p99Ms / p99Target),
      targetScore((1 - availability) / (1 - availabilityTarget)),
      targetScore(cost / problem.budgetPerMonth),
      storageScore,
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
    };
  });

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
  };
}
