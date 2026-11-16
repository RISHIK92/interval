# Phase 6 checklist (HLD battles, W36–W44)

Checked locally on 2026-11-16, before anything is deployed (ADR-0013).

- **Code:** each week's commit is green in CI, through Week 44. On this 8 GB Mac the full `pnpm check` struggles: Postgres restarts under load and suites time out. Every week was checked package by package instead.
- **Infra:** both stacks synthesize with `pnpm --filter @interval/infra synth`. The AWS stack has the `Interval/Hld ScoredWithoutRubric` metric. Nothing has been deployed.

**Not walked by hand:**

- no HLD match, tournament or spectating was played in a browser (Chrome is off by the owner's rule);
- no model key is set, so the judge and coach haven't run against a real model;
- the load test was only checked with 4 players against the dev server.

## "Done when"

| Goal                                                                             | Where it's measured                                                                  | State                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 95% of simulations finish within 2 s                                             | k6: `pnpm load:hld`, then `scripts/load/hld-round.js` (docs/runbooks/load-test.md)   | **Owner to run.** The engine alone simulates the largest design (40 nodes, 80 edges) in well under that (`simulate.test.ts`). |
| The judge is within 1 point of the owner's grade on at least 85% of rubric items | `eval-hld-judge` against `/admin/hld-calibration`'s grades and every resolved appeal | **Owner to grade and run** (it calls the model). It also fails if an injection design is graded above the owner.              |
| Under 5% of results disputed                                                     | `/admin/hld-appeals`: the last 30 days' appealed match judgements over graded ones   | Built. Measured once matches run.                                                                                             |
| Every variant passes validation                                                  | `families.test.ts`: every pool seed, practice seed and cup seed validated (HLDQ-3)   | Holds: 8 families × 2 leagues × 12 seeds, 8 practice seeds, 4 cup seeds.                                                      |
| The first cup finishes without a rejudge                                         | The owner's cup (docs/runbooks/hld-cup.md)                                           | **Week 45, the owner's.**                                                                                                     |

## What Phase 6 built

| Week   | What it added                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| W36    | `packages/hld`: the design graph, the 12-component catalog, spec v1.0 (PROVISIONAL), `/hld/spec`                        |
| W37–38 | The analytical simulator (M/M/c, Erlang C, caches, queues, failures, cost, storage); the problem format; golden designs |
| W39    | The React Flow canvas; solo practice (ADR-0042); autosave; the preview with hints                                       |
| W40    | 8 problem families; seeded variants; auto-sized reference designs; flawed-design catalogs; validation; the pool         |
| W41    | The AI judge (median of 3, 0–4 levels, injection-hardened) and coach; calibration; appeals                              |
| W42    | Matches in the web app (ADR-0043); scoring with the baseline gate; HLD ratings; the casual queue; ranked windows        |
| W43    | Tournaments: Swiss, the bracket, universities, check-in, the admin tools                                                |
| W44    | Cup problems; spectating and replays; results with the rubric; the load test                                            |

## For the owner

- **ADRs:** accept or reject ADR-0042 (solo practice) and ADR-0043 (matches in the web app).
- **Content:** review spec v1.0, the 8 families and the 3 cup problems (all PROVISIONAL).
- **The judge:** grade the calibration set, then run `eval-hld-judge`.
- **Load:** run the HLD load test.
- **Confirm Claude's defaults (Q-P6-07):**
  - tournament matches are unrated;
  - a draw is ½, and two empty designs are no contest;
  - an exact bracket tie goes to the higher seed;
  - university scores count Swiss points;
  - byes count as "in the round" for spectating.
- **Open questions:**
  - a timer to move unvisited matches on (ADR-0043);
  - a daily cap on practice feedback;
  - HLD window reminders and a matched-rate event;
  - whether an appeal resolved after scoring should re-score the match.
