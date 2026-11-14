# 0042. HLD solo practice: any signed-in player can design against a practice problem

- Status: PROPOSED
- Date: 2026-11-14
- Supersedes: none
- Superseded by: none

## Context

Phase 6 Week 39 builds the HLD canvas (CANVAS-1, CANVAS-2): "the React Flow canvas, configuration panels, justification notes, autosave, preview simulation, hints" (docs/roadmap/phase-6.md). HLD matches, the canvas's only use in docs/product.md §6.4 ("System design battles"), arrive in Week 42.

The product describes no solo HLD practice. Q-P6-03 (owner, 2026-11-14) put autosave "on the server, one design per user per match", but no match exists before W42. Asked where the canvas lives until then, the owner chose "Solo practice for all": a page any signed-in player can use, with autosave per player per problem. That is new product behaviour, so it is recorded here.

## Options

### A. Solo practice for all (the owner's answer)

- `/hld/practice` lists the practice problems; `/hld/practice/<slug>` is the canvas with the live preview and hints. The design autosaves to `hld_practice_design`, one per player per problem, versioned so that a stale tab can't overwrite a newer save.
- Pros: the canvas is used and tested by real players before matches; practice teaches the spec sheet without a clock or an opponent.
- Cons: a new surface to keep; the preview's numbers are visible without a match, so problems used in practice shouldn't be used in ranked matches.
- Cost to reverse: low. Drop the two pages and the table; the canvas component moves to the match page in W42.

### B. Owner-only preview until W42

- Pros: no new product behaviour.
- Cons: nobody but the owner sees the canvas until W42.
- Cost to reverse: none.

## Recommendation (not a decision)

A, as the owner chose. Keep practice problems apart from match problems (W40's families can mark which pool a problem is in).

## Consequences

- `packages/hld/src/practice.ts` holds the practice problems until W40's families.
- The `hld_practice_design` table, the `HldPracticeDesigns` port and its Kysely adapter.
- `/hld/practice` and `/hld/practice/<slug>` in the web app, for signed-in players and guests with a session.
- W42's match designs are kept per match, with every version kept as the replay (Q-P6-03); practice keeps only the latest.

## Open questions

- Should practice count toward learner state (practiced concepts) once the rubric judge exists (W41)?
