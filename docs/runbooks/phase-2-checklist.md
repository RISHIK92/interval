# Phase 2 checklist (P2-W12-S06)

Walked locally on 2026-10-29 at commit dd1331e, before anything is deployed (ADR-0013). Each row says what to do, what should happen, and how it was checked. The automated suite (`pnpm check`, 25 tasks) covers every row; "walked" means it was also done by hand in the dev app (127.0.0.1:3100 with the throwaway test account, or read-only in the owner's session on localhost:3100).

## Phase 2 "Done when" (docs/roadmap/phase-2.md)

| Metric                                  | Query                                   | Fixture test                    | Local events                                          |
| --------------------------------------- | --------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| ≥30% of finished moments lead to a quiz | `packages/events/queries/quiz_rate.sql` | `test_metric_queries.py` passes | runs: developer 5 finished / 0 quizzed, student 2 / 0 |
| <2% of questions flagged                | `flag_rate.sql`                         | passes                          | runs: 0 answered questions in the window              |
| Quiz takers return more often           | `quiz_return.sql`                       | passes                          | runs: no cohort old enough yet                        |

The local numbers come from a handful of test accounts over four days: they show the queries run on real event files, not whether the targets are met. That needs beta traffic after deploy.

## Features, Weeks 7–12

| Week | Feature                                    | Do                                       | Expect                                                                                                         | Checked                                                            |
| ---- | ------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| W7   | Notes and reading mastery                  | Library, Profile "Your concepts"         | Notes list (empty for the test account), concepts with Explored / Practiced states                             | walked; tests                                                      |
| W8   | Question pipeline                          | `/admin/questions`                       | Generated questions with the validator's verdicts                                                              | tests (admin page tests, question stage); live in earlier sessions |
| W9   | Test 60s                                   | "Test yourself" on a feed card           | Timer, a live question, "Correct", Report a problem; `quiz_started` and `quiz_answered` land in `.data/events` | walked (events confirmed)                                          |
| W9   | FSRS reviews and the review queue          | Library, Start review                    | One question per due concept; answered "Correct"                                                               | walked                                                             |
| W10  | Topic paths, checkpoints, feed path card   | Paths; Home's "Your path"                | The user's path with Continue, other paths, checkpoint state                                                   | walked                                                             |
| W11  | PDF books: upload, chapters, sessions, OCR | Paths, Your books                        | Books with sessions and progress; a scanned sample processed by OCR                                            | walked; tests                                                      |
| W11  | PDF reader, book sessions and checkpoints  | Resume a book session                    | Pages render; Mark done, Previous/Next; chapter checkpoint "Not yet · Retry" shown                             | walked                                                             |
| W12  | Connect GitHub (ADR-0024)                  | Profile, GitHub                          | "Connect GitHub" for an unconnected account; the owner's account shows repositories with "Uses …"              | walked (test account); owner's connection verified live in S01–S04 |
| W12  | Technology table and suggestions           | `/admin/technologies` (owner)            | 71 technologies, 3 pending AI suggestions labelled with their model                                            | walked, read-only                                                  |
| W12  | Projects in the feed, the stack goal       | Owner's feed; onboarding/Profile choices | "Uses PostgreSQL, from your projects."; "Get better at the stack I use" selectable                             | walked                                                             |
| W12  | Project-aware notes                        | Owner's feed, 3–8                        | "For your project RISHIK92/velox: …" in its own AI box under the note                                          | walked, read-only                                                  |

## Deployment modes

| Check                                                                                                                                                                                                                                            | Result                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @interval/infra synth`                                                                                                                                                                                                            | both stacks (`interval-prod`, `interval-prod-aws`) synthesized                                                                                                                        |
| VM smoke run: `write-env.sh` with fake secrets, `docker compose -p interval-smoke -f deploy/compose.prod.yml --profile local-s3 up -d --build --wait` with `ENV_DIR`, `PGDATA_DIR`, `VALKEY_DIR`, `FILES_DIR` in a temp dir and `HTTP_PORT=8080` | every service healthy (caddy, web, worker, postgres, valkey, seaweedfs, ocr); migrations exited 0; `/api/health` 200 and the landing page 200 through Caddy; torn down with `down -v` |

Note for the next smoke run: the `local-s3` profile needs `FILES_DIR` as well (docs/runbooks/vm.md doesn't list it among the local variables).

## Seen while walking (not fixed here)

- In dev, the first answer on a quiz takes several seconds while Turbopack compiles the server action; production builds don't compile on demand.
- The drift audit's findings: docs/audits/2026-10-29.md.
