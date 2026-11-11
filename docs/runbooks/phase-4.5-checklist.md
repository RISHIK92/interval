# Phase 4.5 checklist (P4.5-W27-S03)

Checked locally on 2026-11-12, before anything is deployed (ADR-0013). Each row gives what to do, what should happen, and how it was checked.

Every row is covered by `pnpm check`. CI is green on `main` through W27-S01. The full check at W27-S01 counted:

| Suite    | Tests |
| -------- | ----- |
| web      | 1540  |
| app      | 113   |
| Python   | 1484  |
| infra    | 94    |
| diagrams | 21    |

W27-S02 added app tests (118) and moved two of the web's tests into diagrams (23).

**Not walked by hand.** No model key is set, so no timeline has been drafted, and none can be approved or played. Claude in Chrome is off by the owner's rule, and nothing ran on a simulator or a phone. Rows marked **owner to walk** need a person, a device or real keys.

## "Done when"

docs/roadmap/phase-4.5.md names no metrics for this phase, so there is no query to add. A listen to an explainer with a timeline is an ordinary listen, so it is already counted by Phase 4's `listen_share.sql` and `explainer_completion.sql`.

## Features, Weeks 25–27

| Week | Feature                   | Do                                                                              | Expect                                                                                                                                                                                                                  | Checked                                                                                                                                                       |
| ---- | ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W25  | Diagram library           | —                                                                               | Client, service, database, cache, queue, group and note on a grid, labelled arrows; one pure description drawn by React DOM SVG (web) and react-native-svg (app), light and dark                                        | tests (description, both renderers); **owner to walk** in the dev client (needs a rebuild for react-native-svg)                                               |
| W25  | Timeline schema and clock | `pnpm --filter @interval/diagrams schema` after a change to `Timeline`          | One zod definition; the committed JSON Schema regenerated (a test fails while it is stale); the clock (`stepAt`, `stateAt`, and `sceneAt` with `fetchTimeline`) shared by both players                                  | tests                                                                                                                                                         |
| W26  | Drafting (`write-scenes`) | `write-scenes --limit 1` (EXPLAINER_MODEL, MEDIA_BUCKET)                        | Only approved, voiced, captioned explainers; the draft checked with jsonschema, retried once with the errors, then stored pending as JSON in the media bucket; a refused one left alone for 7 days; the budget stops it | tests with a fake model; the worker image (below) reads the schema and checks a draft offline; **owner to run** with a model key (no model run, owner's rule) |
| W26  | Review                    | `/admin/explainers` → Timelines                                                 | Each pending timeline drawn with a step scrubber beside its captions, labelled AI-drafted; a broken one lists its problems and can only be rejected; approval re-checks every rule on the server                        | tests (adapter, loader, page, action); **owner to walk** (needs a drafted timeline and MEDIA_* in .env)                                                       |
| W27  | Web player                | Reader → Listen on an explainer with an approved timeline; open the full player | The drawing above the captions, stepping with the narration; each step in a live region for screen readers; in the AI box; a fade only without reduced motion; never in the mini-player                                 | tests; **owner to walk** in a browser                                                                                                                         |
| W27  | App player                | The same in the app                                                             | The drawing above the captions; each step announced once for screen readers (description not shown); in the AI box; no animation                                                                                        | jest-expo tests; **owner to walk** on a phone (dev client rebuild)                                                                                            |

## Deployment modes

| Check                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @interval/infra synth` | Both stacks (`interval-prod`, `interval-prod-aws`) synthesized. Two warnings: the VM's AMI is hardcoded (deliberate, pinned in P1, see the progress log); and the worker's Fargate service uses the default `minHealthyPercent` of 50%. The web task role now reads the media bucket (W26-S02).                                                                                                                                                                                                                       |
| Worker image                          | `docker build -f workers/jobs/Dockerfile -t interval-check-worker .` built (783 MB). Run with `--network none`, it reads `/app/packages/diagrams/schema/timeline.schema.json` and refuses `{}` for its missing `diagram` and `steps`. So the image carries the schema and jsonschema, with no model and no network. A test now pins the copy (`scripts/tests/test_compose_prod.py`). The web image wasn't rebuilt: only TS sources it already copies changed (`packages/diagrams/src` has been copied since W25-S01). |
| VM smoke run                          | Not repeated. Compose, Caddy and `write-env.sh` are unchanged since the 2026-11-11 run. The web reads `MEDIA_BUCKET` and `MEDIA_S3_ENDPOINT` from the same `app.env` the worker does.                                                                                                                                                                                                                                                                                                                                 |

## Seen while checking (not fixed here)

- If an explainer is voiced again after its timeline is approved, the steps' caption-word anchors can drift unseen. `stepAt` tolerates it, but nothing re-checks the anchors.
- Pending and rejected timelines sit in the public media bucket under unguessable keys (AI text only; the players offer only approved ones). Nothing deletes rejected files.
- If the media bucket can't be read while a timeline is pending, the whole Explainers admin page fails, script review included. Accepted as a loud failure on an owner-only page (W26-S02).
- Android 16 deprecates `announceForAccessibility`. It still works through React Native.
- The web player's effect guard against a fetch finishing after unmount has no test: apps/web has no DOM test environment, which would be a new dependency.
- The synth's `minHealthyPercent` warning on the worker service (above).
- The image `interval-check-worker` is left in Docker for the owner to remove.
- **Owner items carried over:**
  - MEDIA_BUCKET and MEDIA_S3_ENDPOINT in .env, then `pnpm files:init`;
  - a model key to run `write-explainers`, `voice-explainers` and `write-scenes`;
  - the dev client rebuild (expo-audio, react-native-svg);
  - the Android release build;
  - `push-due` and `write-scenes` in CLAUDE.md's command list;
  - dropping the scratch database `interval_ci_check` and the `interval-smoke-*` images.
- The drift audit's findings: docs/audits/2026-11-12.md.
