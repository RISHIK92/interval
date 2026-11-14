# Phase 5 checklist (P5-W35-S04)

Checked locally on 2026-11-14, before anything is deployed (ADR-0013).

- **Code:** `pnpm check` is green, and so is CI on `main`, through the Week 34 commit. A few DB-backed web suites time out under full-check load on this Mac; they pass when run alone.
- **Infra:** both stacks synthesize with `pnpm --filter @interval/infra synth` (`interval-prod`, `interval-prod-aws`). Nothing has been deployed.
- **Drift audit:** docs/audits/2026-11-14.md. The bugs it found from this phase were fixed in d9b4da6, and its ADR items are listed under "For the owner".

**Not walked by hand.** These need a person, a configured Velox, or real keys:

- no live battle was played end to end;
- no model key is set, so the interviewer and code review haven't run against a real model;
- Chrome is off, by the owner's rule.

## "Done when"

| Goal                                                      | Where it's measured                                                                                | State                                                                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| At least 80% of window registrants matched                | `packages/events/queries/window_matched.sql` (Athena; DuckDB-tested), from `battle_window_grouped` | Built. Grouping makes rooms of 4, 3 or 2; only a remainder of one plays alone. Measured once windows run.                                  |
| Verdicts within 10 s for 95% of submissions               | k6: `pnpm load:prepare`, then `scripts/load/window-start.js` (docs/runbooks/load-test.md)          | **Owner to run** (k6, and Velox configured). Velox's limit is wall-clock time, so a cold or loaded host adds about 4 s of Docker start-up. |
| No sandbox escapes                                        | Velox's red-team suite (Velox docs/runbooks/redteam.md)                                            | Locally, all 22 contained (2026-11-14). **Owner to run** the gVisor and Judge0 rows on Linux.                                              |
| Under 3% of results disputed                              | `/admin/disputes`: the last 30 days' disputed battles over finished ones                           | Built. Measured once battles run.                                                                                                          |
| Every problem's tests catch at least 90% of injected bugs | `pnpm --filter @interval/lld verify <dir> --mutation`, per problem                                 | 12 problems, all at or above 90%. The four new ones scored 96%, 99%, 97% and 100%.                                                         |

## What Phase 5 built

| Week    | What it added                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W28–W30 | Velox as the execution service (ADR-0041 PROPOSED); the problem format and pipeline (verify, mutation, six languages)                                    |
| W31     | LLD battles (the game server's actor, Velox judging, Monaco, an extension round, fair-play signals and snapshots)                                        |
| W32     | 1v1 Glicko and room OpenSkill ratings; rooms of up to 4; ranked windows with registration, reminders and grouping; the casual queue with a solo fallback |
| W33     | The AI league (pools, the toggle, per-league queues and windows); season battle boards; code similarity; ask the interviewer; 2 AI-league problems       |
| W34     | 12 problems; the k6 load test; the red-team rerun                                                                                                        |
| W35     | Results and replays; the AI code review; disputes; the metric query                                                                                      |

## Deferred

- **W32-S03, scheduled scaling:** the game server can't simply scale; it needs a numbered second server.
- **The full AI-league format,** with 3 extension rounds and injected collaborators. It comes after Phase 5 (Q-P5-20, amended).

## For the owner

- **ADRs:** accept or reject ADR-0039, 0040 and 0041.
- **Configuration:**
  - set `VELOX_URL` and `VELOX_API_KEY` in both stacks, and `JUDGE_API_KEY_IDS` in Velox's `.env`;
  - set `QUESTIONS_MODEL` on AWS;
  - set `BATTLE_WINDOW_TIME_ZONE`.
- **Runs:** k6; the gVisor and Judge0 red-team rows.
- **Content:** review the 12 PROVISIONAL problems; decide the "owner reviewed" gate.
- **The audit's "Needs an ADR" list:**
  - LOAD-3 priorities;
  - EXEC-2 per-language limits;
  - casual rooms (C-31);
  - guests in battles;
  - AI-3 citations;
  - text-check enums;
  - boards and replays outside Redis and CloudFront;
  - Submit idempotency keys;
  - metrics for judge failures and AI over-budget;
  - AiBox for the battle AI text.
- **Cleanup:** remove the accidental `packages/db/db/schema.sql` (committed in 380c932, unused), with your go-ahead.
