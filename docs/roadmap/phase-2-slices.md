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

## Week 8: generator-validator questions, spot checks, difficulty

### P2-W8-S01 Question bank and generator
- IDs: Q-1, AI-3, AI-4, ING-2, OPS-4, LOAD-5
- Needs: tagging (P1-W3-S02)
- Goal: each tagged full-text moment gets 2 multiple-choice questions drafted by the question model, citing its text, saved as pending.
- Acceptance: migration `question` and `question_concept`; a pure prompt and reply parser (2 questions, 4 distinct options, one key, a verbatim citation of at most 300 characters, else refused); stage `generate_questions` through the gateway (feature `questions`), once per moment by content hash; a rate limit or model error re-enqueues the job 5 minutes later and logs it; `QUESTIONS_MODEL` unset means off; tagging queues it, `enqueue-questions` backfills.
- Out of scope: validation (S02), any UI.
- Q: Q-P2-08, Q-P2-09, Q-P2-10, Q-P2-12.

### P2-W8-S02 Validator
- IDs: Q-1
- Needs: S01
- Goal: a second, blind call answers each pending question; a match makes it live, a mismatch rejects it.
- Acceptance: stage `validate_question` (never sends the key); the validator's answer is kept; an unparseable reply retries in 5 minutes; a report of the pass rate and a sample.
- Out of scope: showing questions to users (Week 9).
- Q: Q-P2-07.

### P2-W8-S03 Spot-check queue
- IDs: Q-2
- Needs: S02
- Goal: a weekly random 10% of new live questions, plus every flagged one, wait for an admin's Keep or Retire.
- Acceptance: a weekly job marks the sample; `/admin/questions` behind `admin.review` shows the moment link, quote, options, key and validator's answer; Keep and Retire are recorded.
- Out of scope: user flagging (Week 9, when users see questions).
- Q: none.

### P2-W8-S04 Starting difficulty
- IDs: Q-3
- Needs: S01
- Goal: each question has a starting difficulty and the fields recalibration will need.
- Acceptance: difficulty from the moment's level (an admin's correction winning); answer and correct counts and an empty calibrated-at stored.
- Out of scope: the IRT recalibration job (Week 9).
- Q: Q-P2-11.
