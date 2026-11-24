# 0052. HLD spec 2.1's engine rules beyond ADR-0050, and the two restored 2.0 lessons

- Status: ACCEPTED (owner, 2026-11-24)
- Date: 2026-11-24
- Supersedes: none
- Superseded by: none

## Context

ADR-0050 (ACCEPTED) set out spec sheet v2.1: the geo index, the connection gateway, the coordination service, [fanout], [hot] and [batch]. ADR-0051 (ACCEPTED) recorded 2.0's rules beyond it and asked that v2.1 revisit web-crawler's and image-resizer's lessons. Q-WD-31: an HLD season is monthly, and v2.1 takes effect at the next boundary after v2.0's (2026-12-01), so 2027-01-01 UTC.

Building v2.1 and its twelve families needed rules ADR-0050's text doesn't state, or states in a way the simulator couldn't validate (HLDQ-3: the reference passes every scenario and each flaw fails exactly its target). CANVAS-4 makes every rule part of the public, versioned spec, so each needs a decision rather than a quiet line of code. CANVAS-3 asks for deterministic, explained results, regression-tested against golden designs.

The owner asked (2026-11-24, through the session's brief) to restore the two lessons 2.0 left to the rubric: a simulated lesson for web-crawler and image-resizer's upload burst.

## Options

### A. Record the rules below, as built

- Pros: every 2.1 family validates in the modes it's played in; each rule is one sentence on the spec sheet or in a family's flaw catalog.
- Cons: more rules than ADR-0050 listed; some read ADR-0050's words a particular way (below).
- Cost to reverse: low until 2027-01-01 (no 2.1 match, round or practice problem exists before it). After that, a balance patch.

### B. ADR-0050's text only

- Cons, each found while building:
  - a coordinator whose region failure takes the majority side can never survive the AI mode's lost region, so job-scheduler would have no AI seeds;
  - a reconnect storm added both to the gateway and to `connect`, which already reaches the gateway, counts it twice;
  - the storage rule would hold a leader lease to the coordinator's 8 GB, so no family keeping 800 GB elsewhere could use one;
  - a hot share divided by regions would make a hot write vanish in the AI mode, though every copy applies every write.
- Cost to reverse: medium.

### C. Leave the new lessons to rubrics

- Cons: the same as ADR-0050's option C: about nine lessons unsimulated, and flaws can't target them.

## Recommendation (not a decision)

Option A. Every rule applies only under a spec version whose feature list has it (2.1 today), so no 1.0 or 2.0 result moves: the 1.0 and 2.0 pool, calibration designs and golden results are byte-identical, except web-crawler and image-resizer, changed on purpose (section 7).

**What would change this:** the owner preferring the adversarial region rule for coordinators (then job-scheduler is human-only), or wanting the storm on both the gateway and `connect`.

## Decision (proposed)

### 1. The connection gateway

- **Who holds the connections.** The problem's `connections`, times the scenario's load, are held by the gateways the client's requests reach, shared evenly.
- **The reconnect storm.** The share of a gateway's servers a failure takes away (a node, a zone, a region) reconnects over `reconnectWindowSeconds`. That rate is added to the problem's `connect` request type when it has one, whose path carries it wherever it goes (the session check, the gateway if routed there). With no `connect` type it's added to the gateway's own load. Not both: that counted it twice.
- **What the player reads:** "gateways loses 35.0% of its servers: 4,060 reconnects a second for 30 seconds."
- **Overload in words:** "gw is overloaded: 400,000 connections is 133.3% of what its 6 server(s) hold."

### 2. The geo index

- **Writes.** A shard's replicas apply each of its updates side by side, so a shard is one write server at `updateCapacity`: writes run on shards × regions servers. Its utilization is ADR-0050's (the write load times 1 + replicas, over that many more servers); only the M/M/c pooling differs.
- **Failures** as for the search index: a node's loss takes one server, and takes the index down when it has no replicas. With no replicas, a zone's loss also loses that zone's share of the cells, as a key-value store with one copy does.
- **Storage:** never where writes are kept (ADR-0050), so a family keeps history elsewhere.

### 3. The coordination service

- **A region's loss** takes the second region's members, ⌊members ÷ regions⌋; the remainder stays with the first region, as a primary's majority would. ADR-0050 says "its half"; this reads it as the smaller half. Read the other way, no design with two regions survives the AI mode's lost region.
- **A zone's loss** takes the zone holding the most of the second region's members (all members with one region), so a zone's loss is never harsher than its region's.
- **Storage.** Its 8 GB cap counts only where it is the only store any write reaches: a design keeping its data there. A leader lease beside a database doesn't make the coordinator hold the database's data.
- **In words:** "leases has lost its quorum: 1 of 3 members left, and it needs 2." Hints and the canvas point at its zones and members, not "nothing to take over".

### 4. Fan-out, hot partitions and batching

- **Fan-out, once per path.** A request fans out at the first worker behind a queue or stream on its path, or with none at its first app service, and never again downstream. Beyond ADR-0050's p99 rounds, its p50 waits ⌈mean ÷ `fanoutParallelism`⌉ rounds.
- **Something must send the deliveries.** A type that goes to many, whose path has no such worker or app service (the client straight to the gateway or the provider), isn't served: "nothing sends them". Otherwise it would reach its deliverer as one message.
- **The busiest partition** of a key-value store, stream, queue or geo index carries its even share of the load, or a hot type's share of its partition, whichever is larger:
  - every copy applies every write, so a write's hot share lands whole on one partition in every region;
  - a read is answered by one copy, so its hot share is divided by the copies that answer it (each region's; a geo shard's replicas);
  - a failure doesn't move the hot partition's load.
- **When it overloads,** its utilization and M/M/1 latency are the component's (ADR-0050), and the load beyond its capacity isn't served: the share served is 1 − excess ÷ load, the excess counted on every copy a hot read is spread over. Its node result says `hot: true`, and hints say more nodes won't help: "Answer hot reads from a cache, or batch hot writes."
- **Batching.**
  - A worker's writes to a datastore, stream or coordinator are divided by its `batch`. Its calls to a provider and its pushes through a gateway are not: each delivery is still one.
  - A batching worker waits to fill a batch from its writes: half the wait at the median, all of it at the 99th percentile, at most `batchMaxWaitSeconds`.
  - An app service's batch is an ID block it leases: only its writes to a coordinator are divided, with no wait, and where a coordinator is all it sends to, that path counts in its latency only as a cache's misses do (when 1 ÷ batch is above 1% for the p99, above half for the p50).
  - A 2.1 design must set `batch` on every app service and worker (1 for none), as a 2.0 design must set a stream's retention; a 1.0 or 2.0 design can't.

### 5. `requires` and problem fields

- `requires` may also name `connection_gateway` (what pushes) and `coordination` (what grants a lease), as ADR-0051's open question foresaw.
- `connections`, `push`, `fanout` and `hotShare` are valid only under the features that bring them (2.1's `gateway`, `fanout` and `hot`).

### 6. Families and their validation (HLDQ-3)

- **A lesson's target may differ by battle mode.** presence's storm fails a lost zone in the human mode and a lost region in the AI mode, which is its harsher storm.
- **A flaw whose naive design can't carry a normal day targets `baseline`,** as ADR-0051's flaws that leave out the work do: positions written to a relational primary, every ID through the coordinator's leader, a broadcast or campaign fanned out inside the request. It's valid when it fails the baseline.
- **The shared spike flaw,** under 2.1, leaves alone a node whose harshest scenario isn't the spike (a session check sized for a reconnect storm).
- **Sizing.** The sizer grows a geo index by shards and a gateway by nodes; a gateway is compute for the spike flaw.
- **Practice families made on 2.1 have no battle seeds** (ADR-0050 §1 as written). The families written before 2.1 keep theirs, so matches on families that moved to practice still rebuild.
- **Connections** are drawn per variant as a multiple of the problem's traffic, after every other number, so no earlier family's draws move.

### 7. The two 2.0 lessons, restored on 2.0

Both families stay on 2.0: each lesson uses only 2.0's per-type loads, scenario minutes and retention, and neither family is drawn or offered before 2026-12-01, so no player has seen the earlier versions. image-resizer's AI pool seeds and both families' calibration designs change; every other 1.0 and 2.0 entry is byte-identical.

- **web-crawler: politeness and the frontier.**
  - The open web's rate limit is politeness: a crawler can't fetch faster than sites allow.
  - A new scenario, "a sitemap floods the frontier: three times the fetches for 90 minutes", backs fetches up in the frontier for 2 to 3 hours.
  - Fetches are due within 4 hours (was 1).
  - The flaw `short-frontier` keeps the frontier an hour, so the flood outlives it and its URLs are lost.
  - Duplicate URLs stay the rubric's (ADR-0050 open question 5 stays open).
- **image-resizer: the upload burst.**
  - Originals upload straight to an originals bucket with signed URLs, and the bucket announces each new one to the renditions queue.
  - A dedicated pool of renderers makes the common sizes, separate from the resizers serving misses.
  - The new scenario, "uploads arrive in a burst: four times as many for an hour", runs on the renderers.
  - Sizes are due within 30 minutes (was 5).
  - The flaw `renderers-for-the-average` misses the burst's target.
  - Uploading through the app service, the earlier shape, filled its bandwidth harder in the burst than in the spike, which is why the burst was left out in 2.0.

## Consequences

- `packages/hld`:
  - `spec.ts`: v2.1, `SPEC_V21_FROM = "2027-01-01"`, its features and notes;
  - `catalog.ts`, `design.ts`: the three kinds and `batch`;
  - `problem.ts`: `connections`, `push`, `fanout`, `hotShare`, and the extended `requires`;
  - `simulate.ts`: sections 1 to 4;
  - `family.ts`: section 6;
  - `families.ts`: twelve 2.1 families and section 7;
  - `coverage.ts`, `hints.ts`;
  - four golden designs for 2.1 (`cells`, `live`, `leases`, `tally`).
- Web: `/hld/spec` shows 2.1, its three kinds marked new, and the engine's rules with the version each arrived in. The canvas draws and labels the new kinds, and warns about a lost quorum and a hot partition.
- Worker: the judge prompt gains one line for each new kind (ADR-0050 §7). The calibration set grows to 186 designs; the owner grades the new ones before their families reach battles.
- No migration: `hld_match.spec` is text.

## Open questions

1. The coordinator's region rule (section 3): the smaller half, as built, or the adversarial reading?
2. Collaborative-editor's snapshot lesson and web-crawler's duplicate URLs stay rubric-only (ADR-0050 open question 5). Model them in a later version, or leave them?
3. Notification-service's priority isolation (a campaign never delaying a password reset) is rubric-only: both pipelines share the push provider, so separate queues change nothing the simulator measures. Is a per-pipeline provider (two rate limits) acceptable in a later version?
