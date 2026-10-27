# Phase 2 slices

Phase 2 (docs/roadmap/phase-2.md) as one-session slices, in the Phase 1 format (docs/roadmap/phase-1-slices.md). Weeks are added as each one starts. Run a slice with `/slice <ID>`.

Field key: **IDs** = decision IDs implemented. **Needs** = slices and ADRs that must be done or ACCEPTED first. **Q** = questions in docs/questions/phase-2.md.

## Week 7: notes, and the mastery table updated by reading

### P2-W7-S01 Mastery table and reading evidence

- IDs: PER-2, PER-1, DB-1, DB-2
- Needs: Phase 1 (finishes, P1-W5-S02; tags, P1-W3-S02)
- Goal: each user has a mastery row per concept they have evidence for; finishing a moment or an article raises its tagged concepts' probability weakly, and their state becomes explored.
- Acceptance: migration `concept_mastery` (user, concept, probability, `learner_state`, evidence count, updated at) with generated types. The update rule and D1 constants live in the progress adapter's finish statements (as built: one statement records the finish and credits it, so they are atomic without a transaction; there is no Progress fake). A new finish credits its concepts; a repeat finish, an untagged item, an opened-only item, a retired concept and a moment its source no longer allows (ING-2) credit nothing; an admin's correction replaces the model's tags; reset-inferred leaves mastery alone. Tests against Postgres in the Kysely adapter's suite.
- Out of scope: quizzes, FSRS, practiced and mastered states, ranking changes, any UI.
- Q: Q-P2-02, Q-P2-03.

### P2-W7-S02 Explored concepts on Profile

- IDs: PER-1, §3.1
- Needs: S01
- Goal: Profile lists the concepts the user has explored, by topic, newest first.
- Acceptance: a Profile section reads mastery through a port; an empty state says finishing sections adds to it; a page test; checked in Chrome.
- Out of scope: the knowledge map, editing or resetting mastery.
- Q: Q-P2-04.

### P2-W7-S03 Notes: storage and writing

- IDs: DB-1, DB-5, §5I
- Needs: none
- Goal: a user can write, edit and delete a private note on a moment or an article from the reader page and Home's Now reading panel.
- Acceptance: migration `user_note` (one per user and target, body at most 2,000 characters, cascading with user and item); a `Notes` port, Kysely adapter and fake; server actions validated with zod; `note_saved` and `note_deleted` events with ids only, never the text.
- Out of scope: highlights (native apps), sharing, notes as mastery evidence.
- Q: Q-P2-01.

### P2-W7-S04 Notes in the Library and on cards

- IDs: §5I, §3.2
- Needs: S03
- Goal: Library has a Notes section, and a card shows the user's note on its item.
- Acceptance: each listed note shows its article title, source and section with a deep link to the publisher's page, plus edit and delete; a card whose item has a note shows a "Your note" line; page tests; checked in Chrome.
- Out of scope: search over notes, collections.
- Q: Q-P2-01.
