# 0050. HLD engine extensions, spec sheet v2 and the HLD practice pool

- Status: ACCEPTED (owner, 2026-11-23)
- Date: 2026-11-23
- Supersedes: none
- Superseded by: none

## Context

The owner's answers of 2026-11-23:

- grow HLD to about 30 problem families, grouped by theme;
- a separate HLD practice pool, mirroring ADR-0048 for LLD: some families practice-only, the rest battle-only, and cups tournament-only;
- extend the engine where the classics need it, for example a geo index for location matching, persistent connections with fan-out, media transcoding pipelines, and consensus or leader election;
- Claude drafts all content and the owner reviews it (PROVISIONAL).

The catalog is planned in [docs/hld-catalog.md](../hld-catalog.md): 31 families in 8 themes, 14 practice and 17 battle.

What the engine and its numbers are bound by:

- **Q-P6-01 (owner, 2026-11-14):** "**Catalog v1:** 12 components" and "**Numbers:** Claude drafts spec v1.0 from typical real-world figures (capacity, latency, cost, failure rates), marked PROVISIONAL. The owner reviews them before launch. After launch, numbers change only at season boundaries, with patch notes (CANVAS-4)."
- **CANVAS-4:** "A public, versioned spec sheet with season-boundary balance patches." Product §6.4: "component stats are published and change only at season boundaries, with patch notes, like balance patches in a competitive game."
- **CANVAS-3:** the simulator models request routing, cache hit rates, M/M/c queueing, storage growth, node, zone and region failures, and availability. Its results "are deterministic, come with explanations, and are regression-tested against golden designs."
- **CANVAS-5:** the same TypeScript engine runs in the browser and on the server.
- **HLDQ-2:** "6 to 8 problem families." About 30 amends this decision, so this ADR records the amendment. docs/decisions.md is not edited.
- **HLDQ-3:** every variant is validated: the reference design passes every scenario, and each flaw fails exactly its target.

Today's engine (`packages/hld/src/simulate.ts`, spec v1.0 in `spec.ts`) cannot show several classic lessons:

1. **Location.** A nearby query on `search_index` asks every shard. A real spatial index asks only a few cells, so shards add query capacity. `cup-ride-dispatch` uses `search_index` for this today.
2. **Persistent connections.** There's no component whose capacity is concurrent connections, no server push, and no reconnect storm when a node dies.
3. **Fan-out.** A post reaches its followers as one write. family.ts says so itself: "an asynchronous write path costs nothing the simulator measures", so news feed's lesson is rubric-only.
4. **Heavy and late work.** A worker job costs the same 1/200 s whether it is a counter increment or a 10-minute transcode. A queue's consumers that fall behind during a spike simply fail. The spec sheet's own summary says a queue "absorbs bursts the workers then drain", but the engine never drains a backlog.
5. **Third-party services.** Card networks, SMS and push providers, and customers' webhook endpoints can't be scaled, and they go down. Nothing models them.
6. **Consensus.** Leader election, leases and ID blocks need a quorum. Its availability (a majority of members) and write ceiling are unlike any v1 component.
7. **Hot keys on writes.** `hotKeySkew` only raises cache hit rates. A viral post's counter or a merchant's balance never overloads one partition.
8. **Bytes.** A 4 MB upload costs an app service the same as a 200-byte redirect, and egress is free, so "upload straight to object storage" and "serve video from a CDN" can't be shown.

## Options

### A. Everything in one spec sheet v2.0

- 4 components and 6 behaviours, released at one season boundary.
- Pros: one balance patch and one recalibration; all 23 new families can be written against a stable spec.
- Cons:
  - the largest engine change at once;
  - the golden designs, the pool and the calibration set all move together;
  - 19 new families wait on the whole engine.
- Cost to reverse: high once seasons have been played on v2.0. A later version can remove a component only by retiring every family that uses it.

### B. Staged: v2.0, then v2.1 at the next season boundary

- **v2.0:** the external provider, backlog and lag, work units, and payload bytes and egress.
- **v2.1:** the geo index, the connection gateway, the coordination service, fan-out, hot partitions and batching.
- **Stage 0, before either:** the pool split and the 4 new families that need no engine change.
- Pros:
  - each patch is smaller and easier to calibrate and explain in patch notes;
  - v2.0 first fixes the engine's most visible gap: queues that don't absorb bursts;
  - families ship in batches as their engine lands.
- Cons: two balance patches; families using v2.1 wait a season.
- Cost to reverse: medium. Each stage stands alone.

### C. Minimal: 4 new components only, the rest left to rubrics

- Pros: the smallest engine change.
- Cons:
  - fan-out, backlog, hot keys and bytes stay unsimulated;
  - about 9 lessons in the catalog become rubric-only (rubric 25 points against simulation 60, §6.4);
  - a flaw catalog can't target them (HLDQ-3), and players see a simulator that passes designs a reviewer would fail.
- Cost to reverse: low.

### D. No engine change: grow to about 30 families on v1

- Cons: the owner asked for extensions. About 19 of the 31 families can't be built as planned. Location and real-time would be represented only by cups.

## Recommendation (not a decision)

**Option B (staged) with the full set below.**

- **Why the full set:** each item is justified by at least two planned families. The usage table in docs/hld-catalog.md shows every item in both pools.
- **Items not proposed,** because no planned family needs one that existing parts can't stand in for:
  - storage tiers;
  - a warehouse or OLAP component;
  - multi-leader replication;
  - a service mesh.
- **Why staged:** CANVAS-4 makes every number change a season-boundary patch. Two smaller patches are easier to calibrate, and players learn two or three new things per season.

**What would change this:**

- the owner wanting all families at once (option A);
- a decision that seasons for HLD differ from the monthly quick-game seasons (open question 1), which changes how long the stages take.

## Decision

### 1. The practice pool (mirrors ADR-0048)

- **The pool field.** `Family` gets a required `pool: "practice" | "battle"`.
  - Practice (`/hld/practice`, `practiceProblems()`) lists only practice families.
  - The match pool (`buildPool`, `pool.ts`) holds only battle families.
  - Cups stay in `CUPS`, in neither pool.
- **A one-way move.** A practice family never moves back to battles: its shape and lesson have been seen with no clock.
- **Seeds.**
  - A practice family keeps its `practiceSeeds` and has no battle seeds.
  - A battle family needs no `practiceSeeds`, so `practiceSeeds` becomes optional, and `buildPool` skips practice families.
  - A practice family may later offer several seeds (a "new numbers" button). That is a UI choice, not part of this ADR.
- **The first practice pool:** url-shortener, photo-sharing, news-feed and search-autocomplete. chat, checkout, metrics-ingestion and rate-limiter stay in battles.
- **Practice rules.** Unchanged from ADR-0042 and Q-P6-05: unrated, autosaved per player per problem, and "Get feedback" within the AI budget (OPS-4).
- **New family fields.**
  - `theme`: one of `storage | feeds | messaging | search | commerce | realtime | pipelines | infrastructure`.
  - `difficulty`: `easy | medium | hard`.

  Both are for listing and grouping only, and change no numbers.

### 2. New components (catalog v2: 16)

The numbers are **PROVISIONAL**, drafted from typical real-world figures for the owner's review, like v1.0.

#### `geo_index`: Geo index

- **What it is.** An in-memory spatial index (geohash, quadtree or S2 cells) of things that move or sit somewhere.
- **Config:** `shards` 1–64, `replicas` 0–5, zones, regions.
- **Routes:**
  - writes (position updates), each to one shard and all its replicas;
  - reads (nearby queries), each to `cellsPerQuery` shards, not all of them (`search_index`'s difference).
- **Queueing.**
  - Writes: M/M/c per shard at `updateCapacity`, with the write load multiplied by (1 + replicas).
  - Reads: M/M/c over (1 + replicas) × shards servers at `capacity`, each query costing min(`cellsPerQuery`, shards) shard-visits.
  - [hot] applies when the problem sets a hot share (a dense city).
- **Availability:** per query, (1 − (1 − a)^(1+replicas))^min(cellsPerQuery, shards). Node and zone failures as for `search_index`.
- **Storage:** memory only. It never counts as where writes are kept (the storage rule), so history must go elsewhere.
- **Cost:** per shard replica per hour.

#### `connection_gateway`: Connection gateway

- **What it is.** Holds clients' persistent connections (WebSocket or long-poll) and pushes messages down them.
- **Config:** `nodes` 1–200, zones, regions.
- **Capacity on two resources:** concurrent connections per node, and messages a second per node. Utilization is the larger of connections ÷ (nodes × `connectionCapacity`) and messages ÷ (nodes × `capacity`).
- **New problem field:** traffic gets an optional `connections`, the concurrent clients at baseline, scaled by the scenario's load.
- **Push.** A request type with `push: true` is served when its path reaches a gateway. The gateway counts as where that work is done, next to datastores and queue-fed workers (`doesWork`).
- **Reconnect storm.** In a scenario that takes gateway servers away, their share of connections reconnects over `reconnectWindowSeconds`. That rate is added to the gateway's load and to the problem's `connect` request type when it has one, so the session check behind it feels the storm.
- **Availability:** as for app services (redundancy = servers). Cost per node-hour.

#### `coordination`: Coordination service

- **What it is.** A small consensus cluster (etcd or ZooKeeper-like) for leader election, leases, locks, ID blocks and config.
- **Config:** `members` (3, 5 or 7), zones (1–3), regions (1–2).
- **Writes:** go to the leader and commit on a majority. One cluster-wide server at `writeCapacity × 3 / members` (more members, slower commits). Base latency is `writeLatencyMs`, plus `crossZoneMs` when zones > 1 and `crossRegionMs` when regions > 1.
- **Reads:** M/M/c over members.
- **Availability (new: a quorum).**
  - Normally: up while a majority is up, the binomial P(at least ⌊members/2⌋ + 1 of members up).
  - A node failure removes one member.
  - A zone failure removes the zone holding the most members (members spread evenly, remainder to the first zones).
  - A region failure removes its half.
  - Below a majority, the component is down.

  This is the lesson: 3 members in 2 zones lose quorum with one zone.

- **Storage:** counts as a store, but holds at most `coordinationStorageGb`. A family that puts its data there fails the storage rule ("don't keep data in the coordinator").
- **Cost:** per member-hour.

#### `external_api`: External provider

- **What it is.** A third-party service the design calls but can't scale: a card network, SMS, email or push providers, customers' webhook endpoints, the open web.
- **Config:** none.
- **Capacity:** one server at the problem's `traffic.providerRps` (a new optional field, the provider's rate limit). Base latency and availability come from the spec sheet.
- **Cost:** per call, `providerCostPerCall`, times the calls in a month at baseline. This is a usage-based cost, the first in the engine.
- **Failure:** the existing `Failure` with `kind: "external_api"` and `scope: "node"` takes it down for the scenario, which is "the provider is down".
- **Work done:** it counts as where a request's work is done.

### 3. New engine behaviours

All are opt-in per problem: a field absent means today's behaviour. That keeps v1 families' results unchanged except where a balance patch says otherwise.

#### [lag]: Backlog and completion targets

- **Problem fields.**
  - Scenarios get `minutes`: how long the spike or outage lasts (default 15).
  - Request types get `completionSeconds`: the target for asynchronous work to be done after it is accepted.
- **When consumers can't keep up.** A queue or stream whose consumers are over capacity (or whose next hop is down, such as a provider outage) builds a backlog of (λ − μ) × minutes × 60 instead of failing the scenario.
- **Drain.** The backlog drains afterwards at μ_baseline − λ_baseline.
- **Served late, or lost.**
  - The work is served late, not lost, when the backlog fits the queue's `retentionHours` (and a stream's retention, a new config field) and the worst lag (minutes + drain time) is within `completionSeconds`.
  - Otherwise the share beyond either limit counts as not served.
- **Normal lag.** Lag on a normal day is the consumer path's p99, from the same M/M/c numbers.
- **Coverage.** A `request` cover with `fast: true` on an asynchronous type checks `completionSeconds`.
- **What the player reads:** "The queue holds 54,000 jobs at the peak and drains in 9 minutes (target 30)."

#### [work]: Work units

- Request types get `work` (default 1): the multiple of a worker's per-job capacity one request costs at a worker. A 600-unit transcode makes one worker node handle 200 ÷ 600 jobs a second.
- It applies only at workers.

#### [fanout]: Fan-out

- Request types get `fanout: { mean, p99 }`: the deliveries one request becomes.
- **Where it starts:**
  - at the first worker behind a queue or stream on the path;
  - with no queue or stream, at the first app service.
- **Load:** every hop after that carries `mean` times the load.
- **Synchronous latency:** a synchronous path waits ⌈p99 ÷ `fanoutParallelism`⌉ rounds of the next hop's p99. That is the naive design's slow post.
- **Asynchronous latency:** the same rounds count toward lag instead.

#### [hot]: Hot partitions

- Traffic gets `hotShare` (per request type or overall): the share of a partitioned component's load on its busiest partition.
- It applies to `kv_store`, `stream`, `queue` and `geo_index` writes and reads.
- That partition is modelled as its own M/M/1 at load × max(1/servers, hotShare). Its utilization and latency are the component's.
- A cache in front still removes hot reads. Batching ([batch]) removes hot writes.

#### [batch]: Worker batching

- **Config.** `worker` gets `batch` 1–1,000 (default 1), and `app_service` gets it too, for ID blocks.
- **Load:** the node's onward write load is divided by `batch`.
- **Lag:** lag adds `batch` ÷ the arrival rate per node. On a normal day that is waiting to fill a batch, capped by `batchMaxWaitSeconds`.
- **Default.** Existing designs parse with `batch` absent, which means 1.

#### [bytes]: Payload bandwidth and egress

- **Payload.** Request types get `payloadKb`. `load_balancer`, `app_service` and `connection_gateway` get `bandwidthMbps` per node in the spec. Their utilization is the larger of requests and bytes against capacity.
- **Egress.** Bytes served to the client are billed by the component that serves them: `cdnEgressPerGb`, or `originEgressPerGb` for anything else, at baseline for a month.
- **Direct uploads.** A direct client → `object_storage` edge is allowed and stands for signed upload URLs. The rubric asks about its authorisation.

### 4. Families and validation

- **Per-family scenarios.** `Family` gets optional extra `scenarios`, for example "the provider is down" or "a gateway node dies". They are added to the shared baseline, peak, zone and region scenarios. `problem.ts` already allows up to 10.
- **Flaws that rewire.** A flaw can be more than `removeNode`: `bypass` (remove a node and connect its senders to its targets for the same routes, the synchronous version of an asynchronous design) or `configure` (change one config field). HLDQ-3's check is unchanged.

### 5. Spec sheet v2 numbers (PROVISIONAL)

#### New components

| Component            | Capacity                                                 | Latency                                                       | Availability     | Cost                   |
| -------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | ---------------- | ---------------------- |
| Geo index            | 5,000 queries/s per shard replica; 40,000 updates/s      | 5 ms query, 2 ms update                                       | 0.999            | $0.20 per replica-hour |
| Connection gateway   | 50,000 connections and 20,000 messages/s per node        | 2 ms                                                          | 0.999            | $0.15 per node-hour    |
| Coordination service | 4,000 writes/s (at 3 members); 20,000 reads/s per member | 8 ms write (+2 ms cross-zone, +70 ms cross-region), 2 ms read | 0.999 per member | $0.20 per member-hour  |
| External provider    | the problem's `providerRps`                              | 250 ms                                                        | 0.995            | $0.0002 per call       |

#### New engine constants

| Constant                 | Value |
| ------------------------ | ----- |
| `cellsPerQuery`          | 3     |
| `reconnectWindowSeconds` | 30    |
| `coordinationStorageGb`  | 8     |
| `fanoutParallelism`      | 50    |
| `batchMaxWaitSeconds`    | 5     |
| `cdnEgressPerGb`         | $0.02 |
| `originEgressPerGb`      | $0.09 |
| `defaultScenarioMinutes` | 15    |

#### Bandwidth per node

| Component          | Bandwidth   |
| ------------------ | ----------- |
| App service        | 1,000 Mbps  |
| Load balancer      | 10,000 Mbps |
| Connection gateway | 1,000 Mbps  |

v1 components' numbers are unchanged in v2.0. A family that adopts a v2 behaviour gets new numbers; a v1 family that doesn't adopt one keeps its results.

### 6. Versions, designs, ratings and seasons

- **Versioned engine code, not just numbers.**
  - `SpecVersion.components` becomes partial by version: v1.0 lists 12 kinds.
  - A design is refused when it uses a kind its spec version doesn't list.
  - Engine branches that are new in v2 run only when the design's spec version has them (by a feature list on the version, never by comparing version strings). `simulate()` on a v1.0 design gives exactly today's result forever, because replays, disputes and appeals re-run old designs.
- **The golden designs.** The three existing ones stay pinned to v1.0. New golden designs are added per new component and behaviour at v2.0 and v2.1 (CANVAS-3).
- **A season boundary, with patch notes.**
  - v2.0 and v2.1 each take effect at a season boundary, with patch notes on `/hld/spec`. Each note says what was added, which families use it, and that v1 families' numbers are unchanged.
  - Designs in flight keep the version they were drawn against (`design.spec`). New matches and practice problems use the current version.
- **Ratings.** HLD ratings (`hld_rating`) soft-reset at the season close as they do now (ADR-0034, the monthly season job). Nothing else is reset.
- **The pool.**
  - `buildPool` sizes reference designs with `CURRENT_SPEC`, so regenerating `pool.ts` at a new version may change which seeds pass.
  - A match row stores (family, battle mode, seed), so `pool.ts` also needs the spec version a seed was validated under. A match rebuilds its problem under that version.
  - A migration adds `spec` to `hld_match` (default `'1.0'`).

### 7. Judge input

- `JudgeInput` already carries each component's kind and config as fields. The new kinds and fields (`batch`, `members`) flow through unchanged.
- The worker's judge prompt needs one line per new kind, so the model knows what a geo index or a coordination service is. That prompt is versioned and re-evaluated against the calibration set.
- No player text moves out of its fenced notes.

## Consequences

- **`packages/hld`:**
  - `catalog.ts`: 4 kinds and their config; `batch` on `worker` and `app_service`; `retentionHours` on `stream`.
  - `spec.ts`: v2.0 and v2.1, with a feature list per version.
  - `simulate.ts`: the new stations and the 6 behaviours, behind version features.
  - `problem.ts`: optional traffic and request fields (`connections`, `providerRps`, `hotShare`, `work`, `fanout`, `payloadKb`, `completionSeconds`, `push`) and scenario `minutes`.
  - `family.ts`: `pool`, `theme`, `difficulty`, extra scenarios, rewiring flaws, optional `practiceSeeds`.
  - `coverage.ts`, `hints.ts` and `catalog.ts`'s names for the new kinds.
  - `practice.ts`: filters by pool.
  - `pool.ts`: records the spec version.
- **Tests:**
  - golden designs per new component and behaviour;
  - a v1.0 design gives a byte-identical result after v2 lands;
  - each family's variants validate (HLDQ-3) and the pool regenerates;
  - quorum, backlog, drain and reconnect-storm cases in `simulate.test.ts`;
  - the 2-second budget test, with a 40-node design of new kinds.
- **The calibration set** (Q-P6-05, about 50 designs): grows with candidates from new families (references, flaws, naive designs). The owner grades them before those families reach battles. The judge's agreement is re-run per stage.
- **Balance:**
  - The AI battle mode's ranges for new families are drafted like the first 8's (more traffic, tighter p99, 1.2× budget).
  - Budgets for new families are set by the sizer.
  - The owner reviews each family's numbers before its batch is committed.
- **Database:**
  - `hld_match.spec`.
  - No table for pools: pools live in the family definitions, as LLD's do in problem files.
  - Practice designs for families that leave practice: open question 3.
- **Web:**
  - the canvas palette gains the new kinds;
  - `/hld/spec` renders every version and its patch notes;
  - `/hld/practice` groups by theme and shows difficulty.

  This touches `apps/web/src/app/hld/**`, not `play/battle/**`.

- **HLDQ-2** is amended from "6 to 8 problem families" to about 30, and the glossary's "Problem family" entry ("6 to 8 at launch") needs the same update once accepted.
- **Slices:** stage 0 (the pool split and 4 v1 families), stage 1 (v2.0 and 8 families), stage 2 (v2.1 and 11 families), each in batches of about 4 families.

## Open questions

1. **Season boundaries for HLD.** Seasons are monthly for quick games (`seasons.py`), and the HLD ratings are soft-reset by the same job. Is a spec patch allowed at any monthly boundary, or only at a longer HLD season (for example quarterly)? This sets the staging's pace.
2. **When the pool split takes effect.** Claude suggests switching once the battle pool would keep at least 6 families (after qa-forum and product-search), not before.
3. **Saved practice designs** for chat, checkout, metrics-ingestion and rate-limiter once they leave practice: hide, show read-only, or delete?
4. **Provider cost.** One spec-wide per-call price, or a per-problem price within spec bounds (SMS is far dearer than a webhook)? The latter puts a number outside the spec sheet.
5. **Duplicate work** (web-crawler's duplicate URLs) and **log replay on open** (collaborative-editor without snapshots): model them as a problem field that multiplies load when a named component is missing from the path, or leave both lessons to the rubric?
6. **Cups.** Should `cup-ride-dispatch` and `cup-live-scores` be rewritten on v2 components before they are used? They are hand-written and retired once played (HLDQ-3), so this is only for unused cups.
7. **Stage order.** v2.0 provider/lag/work/bytes first, or the owner's named examples (geo index, gateway, coordination) first?
