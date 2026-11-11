# Phase 4.5 slices

DRAFT (2026-11-11), with the owner's answers to docs/questions/phase-4.5.md the same day. Phase 4.5 (docs/roadmap/phase-4.5.md): visual explainers, as one-session slices in the Phase 1–4 format. Run a slice with `/slice <ID>`.

Field key: **IDs** = decision IDs implemented. **Needs** = slices and ADRs that must be done or ACCEPTED first. **Q** = questions in docs/questions/phase-4.5.md.

Already in place, so not sliced again:

- **Explainer scripts, voicing, captions and the players** (P4-W22, P4-W23): a timeline is drawn over an approved, voiced explainer, in the full players that already exist.
- **The media bucket and `/media/*`** (P4-W22-S04): timelines are files there, as the audio is.
- **JSON Schema codegen** (ADR-0010): queue messages already generate TS and Python types; the timeline schema uses the same mechanism.

## Week 25: the diagram library and the scene timeline

### P4.5-W25-S01 The diagram library

- IDs: ARCH-3, TTS-5, CANVAS-1
- Needs: none
- Goal: `packages/diagrams`, holding:
  - the shapes for system concepts (client, service, database, cache, queue, group, labelled arrow, note), placed on a grid;
  - a pure description of a diagram (shapes and places to SVG elements as plain data);
  - two thin renderers: React DOM SVG on the web, react-native-svg 15.16.0 in the app.
  - Data and drawing are kept apart for React Flow later.
- Acceptance: every shape draws on both platforms from the same description; tests on the description and on each renderer.
- Q: Q-P4.5-01.

### P4.5-W25-S02 The scene-timeline schema and its clock

- IDs: TTS-5, TTS-3, ADR-0010
- Needs: S01
- Goal:
  - a JSON Schema for a timeline: shapes, then steps, each anchored to a caption word, showing, highlighting or moving shapes and arrows, with a text description;
  - TS and Python types generated from it;
  - a validator (shapes exist, anchors in order and within the captions);
  - a shared `stepAt(timeline, captions, seconds)` for both players.
- Acceptance: the schema, its generated types and the validator are tested on fixtures; codegen is in the stale check.
- Q: Q-P4.5-02.

## Week 26: drafting and review

### P4.5-W26-S01 Drafting timelines

- IDs: TTS-5, AI-1, AI-3, OPS-4, DB-6, ADR-0038
- Needs: W25-S02
- Goal: `write-scenes`:
  - `EXPLAINER_MODEL` through the gateway drafts a timeline for each approved, voiced explainer, from its script and captions, using only the library's shapes, within the budget;
  - drafts are validated against the schema (a failure is retried once, then recorded);
  - each is stored as pending, with the JSON in the media bucket.
- Acceptance: tests with a fake model (valid, invalid, over budget); no model run (no key).
- Q: Q-P4.5-03.

### P4.5-W26-S02 Reviewing timelines

- IDs: AI-1, Q-P4.5-03
- Needs: S01
- Goal: `/admin/explainers` shows a pending timeline drawn with the library beside its captions, stepping through with a scrubber; the owner approves or rejects it.
- Acceptance: tests for the list, the drawing, and approve and reject.

## Week 27: the players and the wrap-up

### P4.5-W27-S01 Visual explainers in the web player

- IDs: TTS-5, §5G
- Needs: W26-S02, P4-W23-S03
- Goal:
  - the full player draws the approved timeline above the captions, stepping with the narration (`stepAt`);
  - each step's description is there for screen readers;
  - reduced motion shows each step without animation;
  - labelled AI.
- Q: Q-P4.5-04.

### P4.5-W27-S02 Visual explainers in the app

- IDs: TTS-5, §5G
- Needs: W27-S01, P4-W23-S02
- Goal: the same in the app's full player, with react-native-svg.

### P4.5-W27-S03 Phase 4.5 wrap-up

- IDs: ADR-0013
- Needs: all of the above
- Goal: Phase 4.5 checked end to end locally.
- Acceptance: `docs/runbooks/phase-4.5-checklist.md` walked; both CDK stacks synth; a drift audit.
