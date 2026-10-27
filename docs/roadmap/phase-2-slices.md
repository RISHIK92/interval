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

### P2-W8-S05 Questions through the batch API
- IDs: Q-1, AI-4, OPS-4, ADR-0008
- Needs: S01, S02
- Goal: drafting and validation run through OpenRouter's Batch API at half price, collected every 30 minutes.
- Acceptance: an `OpenRouterBatches` adapter (submit with `requests` last, status, results by custom_id, cost required, the price cap on the `:batch` listing) behind `AiGateway.submit_batch` / `collect_batch` (budget before, cost recorded at collection); `question_batch` / `question_batch_item`; `question-batches` collects then submits, freeing failed batches and capping broken replies; batch mode keeps tagging from queuing per-moment drafting; a VM timer and an AWS schedule every 30 minutes.
- Out of scope: other features' batching.
- Q: Q-P2-13.

## Week 9: test yourself, mastery from quizzes, the review queue

### P2-W9-S01 Quiz attempts and answers
- IDs: PER-2, Q-1, LOAD-5, DB-5
- Needs: P2-W8-S02 (live questions)
- Goal: the server runs a 60-second sprint for a moment or an article: it picks the next live question, checks each answer, and records it.
- Acceptance: migration `quiz_attempt` (user, moment or article or review, started at, ends at) and `quiz_answer` (attempt, question, chosen, correct, answered at; one per question per attempt, idempotency key); next-question selection (the moment's own first, then the same concepts; never twice in an attempt; none after the clock, with a few seconds' grace); `question.answer_count` and `correct_count` updated; events `quiz_started`, `quiz_answered`, `quiz_finished`.
- Out of scope: the UI (S02), mastery (S03), FSRS (S04).
- Q: Q-P2-14, Q-P2-20.

### P2-W9-S02 Test 60s
- IDs: PER-2, ING-2
- Needs: S01
- Goal: a user can take Test 60s at the end of a section, from a card, and from the article sheet, with instant feedback and a results screen.
- Acceptance: the end-of-section sheet offers test or continue; the card's Test 60s and the article sheet open the quiz when live questions exist; one question card (stem, 4 options, a countdown) shows right or wrong and the right option after each answer; results show answered, correct and the concepts' new states; works on a phone.
- Out of scope: flagging (S07), reviews (S05).
- Q: Q-P2-14.

### P2-W9-S03 Mastery from quiz answers
- IDs: PER-2, PER-1
- Needs: S01, P2-W7-S01
- Goal: each answer updates its concepts' probability and state strongly, reaching practiced and mastered.
- Acceptance: p ← p + 0.3(1 − p) when right, 0.7p when wrong, in the same statement that records the answer; practiced at p ≥ 0.5, mastered at p ≥ 0.85 with 2 correct reviews on separate days; reading never lowers a quiz-earned state; Profile shows each state.
- Out of scope: due for review (S04).
- Q: Q-P2-15.

### P2-W9-S04 FSRS review cards
- IDs: PER-2
- Needs: S01
- Goal: each concept a user is quizzed on gets an FSRS card, rated once per quiz, so it comes due on a spaced schedule.
- Acceptance: `ts-fsrs` (owner-approved); migration `concept_review` (user, concept, the FSRS card's fields, due); a finished quiz or review rates each concept it tested (all right Good, any wrong Again); default parameters; "due for review" when due ≤ now.
- Out of scope: the queue UI (S05), feed slots (S06).
- Q: Q-P2-16.

### P2-W9-S05 The review queue
- IDs: PER-2, §5I
- Needs: S04, S02
- Goal: the Library's top card is the review queue, and a review session asks one question per due concept.
- Acceptance: the top Library card shows the due count, the concepts and a time estimate; a session asks one live question per due concept, most overdue first, up to 10, untimed, with the S02 card; the session rates the cards (S04) and updates mastery (S03).
- Out of scope: feed slots (S06).
- Q: Q-P2-17.

### P2-W9-S06 Review slot in the feed
- IDs: REC-1, PER-2
- Needs: S05
- Goal: when anything is due, the feed's second card is "Review N concepts · ~1 min", linking to the review queue.
- Acceptance: added when the feed is served, not precomputed; only when something is due; says why it's there (Every card says why it was recommended, §5B); ranking otherwise unchanged.
- Out of scope: per-concept review cards in the feed.
- Q: Q-P2-17.

### P2-W9-S07 Flagging questions
- IDs: Q-2
- Needs: S02, P2-W8-S03
- Goal: a user can flag an answered question with a reason; it leaves quizzes and goes to the spot-check queue.
- Acceptance: a Flag control with reasons on the answered card; one flag per user per question; a flagged question isn't served; the admin's Keep returns it; event `question_flagged`.
- Out of scope: penalties or anti-cheat.
- Q: Q-P2-18, Q-P2-20.

### P2-W9-S08 Difficulty recalibration
- IDs: Q-3
- Needs: S01, P2-W8-S04
- Goal: a weekly job recalibrates difficulty from answers and pulls anomalies for review.
- Acceptance: a Python job fits a one-parameter IRT model; a question with at least 30 answers gets a recalibrated level and `calibrated_at`; one over 98% or under 20% correct goes to the spot-check queue; a VM timer and an AWS schedule weekly; metric queries for the Phase 2 "done when" lines.
- Out of scope: per-user ability in ranking.
- Q: Q-P2-19, Q-P2-20.

