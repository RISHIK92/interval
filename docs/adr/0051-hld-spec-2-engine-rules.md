# 0051. HLD spec 2.0's engine rules beyond ADR-0050, and `requires`

- Status: ACCEPTED (owner, 2026-11-24)
- Date: 2026-11-24
- Supersedes: none
- Superseded by: none

## Context

ADR-0050 (ACCEPTED) set out spec sheet v2.0: the external provider, [lag], [work] and [bytes]. Building stage 1's seven families needed engine rules its text doesn't state. CANVAS-4 makes every number and rule part of the public, versioned spec, so each needs a decision rather than a quiet line of code. CANVAS-3 asks for results that "are deterministic, come with explanations, and are regression-tested against golden designs". HLDQ-3 asks that each flaw fail exactly its target.

The review of the uncommitted stage 1 work found a blocker. ADR-0050 says a request is served once its path reaches "where that work is done": a datastore, a queue-fed worker or the provider. A design could therefore drop the provider and still serve every type:

- otp-login with no SMS provider kept its 60 points and its cost fell from about $203,000 to $3,600 a month;
- webhook-delivery and video-on-demand without their queue kept 60 points, because the app service still reached a store.

Nothing measured the work the request exists for: the code sent, the event delivered, the upload transcoded.

The owner's answers of 2026-11-24:

- 1.0 families stay on spec 1.0 for good.
- The engine additions beyond ADR-0050 are recorded here, accepted.
- Provider prices stay PROVISIONAL. web-crawler (its lessons rubric-only) and image-resizer (no upload-burst scenario) ship now and are revisited in v2.1.
- The blocker fix: a 2.0 `requires` per request type, and one flaw per affected family that leaves out what it requires.

## Options

### A. A `requires` list per request type

- Each request type may name the kinds that must do its work. Under a version with the feature, a type whose routes never reach one of each kind isn't served.
- Pros:
  - one problem field and one rule;
  - it says what the lesson is ("a code isn't sent until it reaches the SMS provider");
  - a flaw catalog can target it (HLDQ-3).
- Cons: another field for families to set.
- Cost to reverse: low while 2.0 isn't in effect (before 2026-12-01). After that, a balance patch.

### B. Count the provider or worker as the only place some types are done

- Change `doesWork` so that, for some types, a datastore no longer counts.
- Pros: no new field.
- Cons: the rule hides in the engine. A type's work can need both a store and a provider (payment capture records and charges), which one sink can't say.
- Cost to reverse: medium.

### C. Leave it to the rubric

- Cons: a design that drops the provider scores full simulation points at a fraction of the cost. That is the opposite of the lesson, and a flaw can't target it.

## Recommendation (not a decision)

Option A, together with recording the stage 1 rules below.

**What would change this:** a v2.1 family whose work needs something more than "reached at all", such as a quorum or an ordered path.

## Decision

All of these apply only under a spec version whose feature list has them: 2.0 today. A 1.0 design's result never moves (ADR-0050 §6).

### 1. `requires` (feature `requires`)

- **The field.** A request type may set `requires`: a non-empty list of `external_api` and `worker`, the minimal set stage 1 needs. The problem must allow each kind it names.
- **The rule.** A type whose routes from the client never reach a component of each required kind isn't served in any scenario: availability 0 and p99 unbounded. The explanation reads: `"request_code" requests never reach an external provider, which does their work, so none is served.`
- **What counts.** Reach is read from the design's edges, whatever is up. An outage is availability, not a missing step.
- **The families:**

  | Family             | Type         | Requires     | Flaw                                 |
  | ------------------ | ------------ | ------------ | ------------------------------------ |
  | otp-login          | request_code | external_api | `no-provider` (without the provider) |
  | webhook-delivery   | event        | external_api | `no-provider`                        |
  | payment-processing | authorize    | external_api | `no-provider`                        |
  | payment-processing | capture      | external_api | (the same flaw)                      |
  | web-crawler        | fetch        | external_api | `no-provider`                        |
  | image-resizer      | original     | worker       | `no-renditions` (without the queue)  |
  | video-on-demand    | upload       | worker       | `no-transcoding` (queue and workers) |

- **Flaws aimed at the baseline.** A flaw that leaves out what does the work targets `baseline`, §6.4's gate. It's valid when it fails the baseline; every other scenario fails with it, since the work is never done. Every other flaw still fails exactly its target (HLDQ-3).
- **`without`** in a flaw may name several nodes (a queue and the workers it feeds).

### 2. Scenarios and lateness

- **Per-type load.** A scenario may set a request type's own load (`loads`), for example "three times the uploads for two hours". Other types keep the scenario's `load`.
- **Late work fails on its own share.** Work done past its completion target or retention misses the availability target on its own share, however small that share is of all traffic. A transcode among a million views still counts.
- **The worst wait** is the scenario's minutes plus the time to drain the backlog. The share past a limit (the completion target or the retention, whichever is smaller) is 1 − limit ÷ worst wait. A backlog that never drains has no lag, and its result says null. Coverage and hints read null as late.
- **Retries behind a queue.** Behind a queue or stream, a provider's or worker's ordinary failures are retried. Only a backlog past its limits is lost.

### 3. The provider

- **Fail fast.** A request type that the provider's outage cuts off entirely counts against what's served, not as an unbounded p99. A card network's outage refuses payments; it doesn't hang them. Our own components' outages still hang, as in 1.0.
- **Its own failures only.** The provider fails only in a scenario that names it (`kind: "external_api"`), never with our zone or region.
- **Prices.** Each family sets its price per call (Q-WD-31). The prices stay PROVISIONAL.
- **Usage costs.** The provider's calls and the bytes served are both billed from the baseline scenario's arrivals for a month. Egress is billed by the client's first hop: a CDN's rate for what it serves, the origin's for the rest.

### 4. Flaws (HLDQ-3)

- **New flaw kinds.**
  - `utilization`: one node sized to run at a given utilization on a normal day, sized for the average.
  - `route`: one request type sent along a given path in place of its own edges.
- **New targets.** A flaw may target `budget`: over budget, and meeting every target once the budget is lifted. Or it may target `baseline` (section 1).
- **The narrower spike flaw.** The shared "no spike headroom" flaw never cuts a worker whose every request type waits in a queue. Such a worker absorbs the spike as a backlog, so cutting it is a lag lesson, not a spike one. The flaw is left out where it would cut nothing.

### 5. Validation by version

- A problem names a published spec version and uses only what it has:
  - its component kinds;
  - the provider's rate limit and price only where the version has the provider;
  - `work`, `payloadKb`, `completionSeconds`, `requires`, and a scenario's `minutes` and `loads` only under the feature that brings each.
- A design under 2.0 must set a stream's `retentionHours`. Under 1.0 it may not.
- A design using a kind its version lacks is refused by `Design`. `simulate` gives an empty, explained result rather than an error.
- The overload note says bandwidth ("6,400 Mbps is 160.0% of the bandwidth its 4 server(s) have") when bytes, not requests, fill a node.

### 6. A family never changes its spec version

- A match records its family's spec version and rebuilds only under it (`matchProblem` refuses any other).
- The families' versions are pinned by a test. A family that needs a newer version's numbers is a new family.
- `hld_match.spec` has no default: every new match says which version it was drawn on. The migration backfills `'1.0'` for earlier matches, then drops the default.

## Consequences

- `packages/hld`:
  - `spec.ts`: the `requires` feature and a patch note;
  - `problem.ts`: `requires`, the version checks;
  - `design.ts`: retention by version;
  - `simulate.ts`: `requires`, the empty result, null lag, arrivals-based usage, the bandwidth note;
  - `family.ts`: the baseline target, `without` with several nodes;
  - `families.ts`: `requires` and the six flaws;
  - `coverage.ts` and `hints.ts`: null lag;
  - `match.ts`: the pinned rule.
- The pool is unchanged. The calibration set changes only for 2.0 families. 1.0 families' pool, calibration and results are byte-identical.
- Web: `/hld/spec` says 1.0 families stay on 1.0 after the boundary. A tournament round on a 2.0 family can't start before 2026-12-01 UTC, whatever the cup's start (the round's `not_yet`).
- v2.1 revisits web-crawler's slow sites and deduplication, and image-resizer's upload burst.

## Open questions

- None for stage 1. v2.1's components may need more `requires` kinds (for example a coordination service), added with the families that need them.
