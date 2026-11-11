# Phase 4.5 questions

Answered by the owner on 2026-11-11 (the suggested defaults). Questions for Phase 4.5 (docs/roadmap/phase-4.5.md): visual explainers. The phase is one line in the blueprint, and TTS-5, CANVAS-1, ARCH-3, DB-6, CACHE-4 and product.md §5G say little more, so these fix what the docs leave open.

Priority: **P0** blocks the week's first slice; **P1** blocks a later slice; **P2** can wait.

## Week 25: the diagram library and the scene timeline

### Q-P4.5-01 What the shared diagram library holds (P0 for W25)

- Cite: ARCH-3 ("the diagram component library"), TTS-5, CANVAS-1 ("React Flow, built on the shared diagram library").
- Why it matters: the HLD canvas (Phase 6) reuses it, so its shapes and its split between data and drawing are hard to change later.
- Suggested default:
  - `packages/diagrams`, a small fixed set of shapes for system concepts: client, service, database, cache, queue, a group boundary, a labelled arrow, a note;
  - placed on a grid, with no automatic layout;
  - the data (shapes and their places) kept apart from the drawing, so React Flow can reuse the shapes as custom nodes later;
  - the web draws with React's SVG elements; the app with react-native-svg 15.16.0 (Expo SDK 58's pin, a new dependency).
- **Answer (owner, 2026-11-11):** the suggested default; react-native-svg 15.16.0 approved.

### Q-P4.5-02 How a diagram keeps time with the narration (P0 for W25)

- Cite: product.md §5G ("Diagrams are synced to the narration"), TTS-3 (word-level timestamps).
- Suggested default: each scene step is anchored to a word of the explainer's captions (P4-W23-S03), not to a second, so it follows the stored word timings at any speed and survives re-voicing as long as the words do.
- **Answer (owner, 2026-11-11):** the suggested default.

## Week 26: drafting and review

### Q-P4.5-03 Who writes a scene timeline (P0 for W26)

- Cite: TTS-5, AI-1, AI-3, ADR-0038 (`EXPLAINER_MODEL`), OPS-4.
- Suggested default:
  - `EXPLAINER_MODEL` drafts a timeline from an approved, voiced explainer's script and captions, through the gateway and within the shared AI budget, using only the library's shapes;
  - the owner approves or rejects each on `/admin/explainers`, as scripts are;
  - timelines are AI output, labelled as such (AI-1), and draw only from the script, never a source's figures.
- **Answer (owner, 2026-11-11):** the suggested default.

### Where a timeline is kept (decided, not asked)

DB-6 ("S3 stores … scene timelines") and CACHE-4 ("CloudFront serves … scene files"): the approved timeline is a JSON file in the public media bucket beside its explainer's HLS, served at `/media/*` (CloudFront on AWS, Caddy on the VM, P4-W22-S04). Its schema is a JSON Schema with generated TS and Python types (ADR-0010's mechanism), so the worker that writes it and the players that read it share one definition (ARCH-2).

## Week 27: the players

### Q-P4.5-04 Where visual explainers are shown (P0 for W27)

- Cite: product.md §5G, §4.1, wireframe 07 (the audio player).
- Suggested default:
  - in the full player (web and app), above the captions, while Smart explain plays; not in the mini-player;
  - each scene has a short text description for screen readers;
  - with reduced motion, each step appears without animation.
- **Answer (owner, 2026-11-11):** the suggested default.
