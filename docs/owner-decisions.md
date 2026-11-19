# Owner decision brief (2026-11-19)

Recommendations are Claude's. Nothing here changes a decision until you accept it.

## ADRs (all PROPOSED)

### 0041 Velox is the execution service (supersedes 0039)

Context: you decided 2026-11-12 that Velox runs code and Interval is its client via the `JudgeJob`/`JudgeResult` contract; `services/exec` is retired. Velox gets the per-run sandbox, gated by the red-team suite.
Options: A Velox as service (your decision); B (0039) own engine in the monorepo.
Recommend: accept A. Conditions: no player code before the gVisor and Judge0 red-team rows pass; checking stays outside the sandbox. Open: Velox's licence and contributors, where it is deployed, API key vs private network.

### 0039 Engine in the monorepo

Context: written before your decision; the code it described is gone.
Options: accept, or reject.
Recommend: reject (or mark superseded) together with accepting 0041, so the record isn't contradictory.

### 0040 LLD contracts from zod

Context: ADR-0010's generator handles only flat messages; the diagram timeline (already owner-approved) and LLD interface, scenario and result are nested. Built with zod as the source, JSON Schema and Go types generated. This amends Q-P5-06's answer.
Options: A zod source (built); B extend the Python generator to nested and Go.
Recommend: accept A: no new dependency, rules live beside structure, cheap to reverse. 0041 depends on it (Go types are copied into Velox).

### 0042 HLD solo practice

Context: no solo HLD practice in the product doc; you chose "solo practice for all" before matches exist (W42).
Options: A practice for all (built); B owner-only preview.
Recommend: accept A. Keep practice problems out of ranked pools. Open: should practice count toward learner state once the judge exists?

### 0043 HLD matches in the web app

Context: the roadmap's "official simulation worker" has no home (no TS worker; simulator must not be written twice). You chose web app plus Postgres. A match moves on only when someone looks at it.
Options: A web app (built); B Go match actor; C new TS worker.
Recommend: accept A. Open: add a worker-called timer endpoint to close unvisited matches. Recommend deferring it until you see unscored matches (watch the `ScoredWithoutRubric` metric), but the cup (hld-cup.md) needs the worker running anyway.

## Phase 5 open items (phase-5-checklist)

- Seven-plus audit "Needs an ADR" topics: LOAD-3 priorities, EXEC-2 per-language limits, casual rooms (C-31), guests in battles, AI-3 citations, text-check enums, boards/replays outside Redis and CloudFront, Submit idempotency keys, judge-failure and over-budget metrics, AiBox for battle AI text. Recommend: batch them into 2-3 ADRs after the runs below; none blocks the runs.
- Content: review the 12 PROVISIONAL problems and decide the "owner reviewed" gate. Recommend: gate ranked windows on reviewed problems.
- Cleanup: delete the unused `packages/db/db/schema.sql` (380c932). Recommend: yes, delete.
- Q-P5-04 (images): Java `eclipse-temurin:21.0.12.1_1-jdk`, C++ `gcc:14.3.0`, Go `golang:1.27.3-alpine` with a warmed build cache, entrypoints disabled. Recommend: confirm; the cache cuts a cold build from 40 s to 2-3 s.
- Configuration: `VELOX_URL`, `VELOX_API_KEY` in both stacks; `JUDGE_API_KEY_IDS` in Velox; `QUESTIONS_MODEL` on AWS; `BATTLE_WINDOW_TIME_ZONE`. Choose the zone to match your players; empty means UTC.
- Phase 5 answers dated overnight 2026-11-12 are all "recommended defaults" awaiting your review (docs/questions/phase-5.md).

## Phase 6 (phase-6-checklist, docs/questions/phase-6.md)

### Q-P6-02 cost default

Context: you left cost unanswered. Default: each problem sets a monthly budget; exceeding it counts as a missed target in every scenario, scored like any other.
Options: keep; or make cost a separate score, or ignore it.
Recommend: keep. It reuses the existing scoring and needs no new rule.

### Q-P6-07 tournament defaults (confirm as a set)

- Tournament matches unrated (a cup has its own standings): keep, avoids double-counting.
- Win 1, draw 1/2 (exact tie), bye 1; two empty designs are no contest: keep.
- Ties: Buchholz, then total match score; bracket exact tie to higher seed: keep (the seed is the earned order).
- University score counts Swiss points (top 5 members): keep; simplest to explain.
- Byes count as "in the round" for spectating, so a bye player can't watch the round live. Recommend changing it: a bye doesn't play that round's problem, so watching gives no edge (a one-line change in `apps/web/src/server/hld-watch.ts`).

### Open questions (none block the cup)

- Timer for unvisited matches (ADR-0043): defer, see above.
- Daily cap on practice feedback: add one if the first week's AI spend shows it; the per-user AI budget already bounds it.
- HLD window reminders and a matched-rate event: add the event now (metric needs it, DB-5 style, cheap), defer reminders.
- Appeal resolved after scoring re-scores the match: recommend no re-score; adjust ratings only if the grade changed the places, and decide when the first one happens.

### Content and runs

Review spec v1.0, the 8 families and the 3 cup problems (all PROVISIONAL); grade the calibration set; run the judge eval and both load tests (see docs/runbooks/owner-runs.md). Cup runs only after the eval passes.
