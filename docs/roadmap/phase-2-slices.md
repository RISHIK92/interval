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

## Week 10: topic paths, launch paths, checkpoints

### P2-W10-S01 Paths and the proposer
- IDs: §5F, DB-2, AI-2, OPS-4, ING-2
- Needs: P1-W3-S01 (concept graph), P1-W3-S02 (tags)
- Goal: the model proposes about 10 candidate topic paths and orders each into sections by prerequisites, saved as drafts.
- Acceptance: migration `path`, `path_section` (ordinal, concepts), `path_session` (ordinal, moment); `ai_feature` 'paths'; `propose-paths` through the gateway (DeepSeek V4.1 Flash): candidates (name, concepts, why) from the concept graph and moment coverage, then each candidate's order from prerequisite edges (the model proposes; edges are checked, a cycle or unknown concept refused); sessions picked deterministically per section (2 to 4 allowed moments, different sources, frameable and with live questions first); drafts never shown to users.
- Out of scope: the admin page (S02), anything users see.
- Q: Q-P2-22, Q-P2-24, Q-P2-25.

### P2-W10-S02 Path review page
- IDs: §5F, Q-2 pattern (admin.review)
- Needs: S01
- Goal: the owner reorders, edits and approves (or retires) proposed paths on an admin page.
- Acceptance: `/admin/paths` behind `admin.review`: each draft's name, why, sections with their concepts and sessions; move a section up or down, rename, remove a section or session, approve (live) or retire; a path needs at least 2 sections to go live.
- Out of scope: users following paths (S03).
- Q: Q-P2-23, Q-P2-24.

### P2-W10-S03 The Paths tab
- IDs: §4, §5F, wireframe 05
- Needs: S02
- Goal: users see the approved paths, start one (one active at a time), and follow its timeline.
- Acceptance: the Paths tab replaces the coming-later placeholder; a list of live paths; Start (pausing any other active path); the path page's timeline: sections in the user's order, sessions with finished state (from section finishes), checkpoint steps with "Pass 4 of 5 to unlock …", locked sections saying what unlocks them; a session opens in the reader; event `path_started`.
- Out of scope: checkpoints themselves (S04), edits (S05), the feed card (S06).
- Q: Q-P2-27, Q-P2-28.

### P2-W10-S04 Checkpoints
- IDs: §5F, PER-2, Q-1
- Needs: S03, P2-W9-S02, P2-W9-S04
- Goal: a 60-second checkpoint of 5 questions after a section; 4 of 5 passes, marks its concepts practiced and unlocks the next section; misses go to review.
- Acceptance: a checkpoint is a quiz attempt on the section (offered once every session is finished or skipped); 5 questions from the section's moments first; the same question card and clock; pass at 4 of 5: concepts raised to at least practiced, the next section opens; missed concepts' FSRS cards due now; retry allowed; events `checkpoint_started`, `checkpoint_finished`.
- Out of scope: book checkpoints (Week 11).
- Q: Q-P2-26, Q-P2-28.

### P2-W10-S05 Editing your path
- IDs: C-25, §5F
- Needs: S03
- Goal: a user can pause and resume their path, reorder sections, skip a section, and swap a session's moment.
- Acceptance: an Edit control on the path page; pause/resume (a paused path leaves the feed; `path_paused` also covers the pause that starting another path causes, so the continuity metric counts it); move a section up or down (a prerequisite now later shows a warning); skip (no practiced credit, next unlocks); swap a session for another allowed moment on the same concept; the approved path never changes; events `path_paused`, `path_section_skipped`.
- Out of scope: creating paths.
- Q: Q-P2-23.

### P2-W10-S06 The next session in the feed, and path metrics
- IDs: REC-1, §5B, §8, DB-5
- Needs: S03, S04
- Goal: the active path's next session (or checkpoint) is the feed's first card, and path progress is measured.
- Acceptance: the card says why ("Next in your path: …"), opens the session or the checkpoint; none for a paused path; read when the feed is served; a metric query for path progress (sections passed per active path per week), DuckDB-tested and saved in the AWS stack.
- Out of scope: path reminders (notifications).
- Q: Q-P2-27, Q-P2-28.

### P2-W10-S07 Skip what you know
- IDs: PER-1, PER-2, §5F, Q-P2-23
- Needs: S05, S06
- Goal: a path section whose concepts the user has all mastered is suggested for skipping.
- Acceptance: on the path page, an open, unpassed, unskipped section whose every live concept is mastered for the user says "You've mastered this" with Skip section (S05's skip, asked first) and Keep it; the feed's path card on such a section adds "You know this" and a Skip button; nothing is skipped without a tap (PER-1); `path_section_skipped` gains `reason` (`user` or `mastered`), version 2.
- Out of scope: skipping automatically; suggestions from practiced (not mastered) concepts.
- Q: Q-P2-29.

### P2-W10-S08 Missing-foundation warning
- IDs: §5F, Q-1 (the concept graph), ING-2, ING-6
- Needs: S05
- Goal: an open section that builds on a concept the user has never explored, outside the path, says so and offers one reading on it.
- Acceptance: on the path page, each open section lists its missing foundations: direct prerequisites (one hop, `concept_edge` prerequisite_of) of its live concepts that aren't among the path's concepts and that the user has never explored (no mastery row); each with one reading (rights allowing, link working, the swap list's rule), opened as a path open so it comes back to the path; the note goes once the concept is explored; no dismiss; at most 3 foundations per section.
- Out of scope: a prompt on Start; prerequisites more than one hop away; per-user generated paths (§5F: a person approves each path).
- Q: Q-P2-30.

## Week 11: PDF books

Owner answers: Q-P2-31..37 (2026-10-28). ADR-0022 (Tesseract OCR) ACCEPTED by the owner the same day.

### P2-W11-S01 Upload a book, privately
- IDs: §5F, DB-6, ING-5, OPS-3, C-11
- Needs: none
- Goal: a user uploads a PDF; it is stored privately and queued for processing.
- Acceptance:
  - "Add a book" on the Paths tab (Your books);
  - a PDF only (checked by its header, not its name), at most 50 MB;
  - at most 5 books per user (entitlement limits, OPS-3);
  - stored with server-side encryption under a per-user key prefix in S3 (SeaweedFS locally, ADR-0011) through `@aws-sdk/client-s3` (approved);
  - a `book` row (title from the file name until processing, status `processing`) and a `book_process` job on Valkey;
  - the user can delete a book, which removes its file and every row;
  - events `book_uploaded` and `book_deleted`;
  - no one else can see or reach it.
- Out of scope: processing (S02).
- Q: Q-P2-34, Q-P2-37.

### P2-W11-S02 Text, chapters and sessions
- IDs: §5F, ING-5, ING-4, §3.2
- Needs: S01
- Goal: a digital PDF becomes chapters and sessions.
- Acceptance:
  - the worker reads the PDF with pdfplumber (approved);
  - an encrypted (DRM) PDF fails with a message ("protected PDFs can't be read", §5F: never bypasses DRM);
  - more than 1,000 pages fails;
  - each page's text is kept privately; a page with no extractable text is marked `scanned` (S03 reads it);
  - chapters come from the PDF's bookmarks, else from heading detection (larger font, short line, top of a block);
  - each chapter's text is split at its headings into sessions of 2–8 minutes, as moments are (ING-4), with the title from the heading;
  - status becomes `ready` (or `ocr` while scanned pages wait);
  - the title comes from the PDF's metadata when present.
- Out of scope: OCR (S03), the reader (S04).
- Q: Q-P2-31.

### P2-W11-S03 Scanned pages through Tesseract
- IDs: ING-5, ADR-0022, ADR-0011, ADR-0014
- Needs: S02
- Goal: scanned pages get their text from a Tesseract service.
- Acceptance:
  - an `ocr` container (`deploy/ocr/`: Tesseract with English plus a stdlib HTTP server, `mem_limit: 512m`) in docker-compose and the VM stack;
  - `OCR_URL` from env;
  - an `Ocr` port with an HTTP adapter and a fake;
  - an `ocr_page` BullMQ stage, one page per job, with retries;
  - the worker renders each scanned page to an image and stores its text;
  - when a book's last page is done, its chapters and sessions are rebuilt and it becomes `ready`;
  - the Fargate service is in the AWS stack (synth only).
- Out of scope: other languages.
- Q: Q-P2-32.

### P2-W11-S04 The reader and saved position
- IDs: §5F, §3.2
- Needs: S02
- Goal: a book's session is read in the app, and the place is kept.
- Acceptance:
  - `/books/[id]?session=` shows the session's extracted text, sized to the break length, for the owner only;
  - the scroll position within the session is saved, and the book opens where the user left off;
  - Previous and Next session;
  - "Finished?" marks a session done, as moments are;
  - text only: figures and tables appear as their extracted text.
- Out of scope: highlights and notes on books.
- Q: Q-P2-31.

### P2-W11-S05 Books in the Paths tab and the feed; the goal
- IDs: §5F, REC-1, §4, ADR-0015
- Needs: S04
- Goal: books are followed like paths.
- Acceptance:
  - "Your books" in the Paths tab with status (processing, reading pages, ready, failed, with the reason);
  - a book's chapter timeline: sessions ticked as finished, the next one first;
  - the next book session is a feed card after the topic path's card ("Next in your book: …");
  - the onboarding and Profile goal "Finally finish that book" is enabled, and choosing it leads to "Add a book" after onboarding;
  - events `book_session_finished` and `book_opened`.
- Out of scope: ranking by goal (ADR-0015).
- Q: Q-P2-33, Q-P2-36.

### P2-W11-S06 Book checkpoints, made on demand
- IDs: §5F, Q-1, Q-2, AI-3, OPS-4, Q-P2-26
- Needs: S05, W10-S04
- Goal: a chapter's end offers a 60-second checkpoint built from that chapter.
- Acceptance:
  - when the user finishes a chapter's sessions, its questions are generated then (owner: on demand) by the W8 generator-validator pipeline from the chapter's text, through the gateway (ADR-0008) and against the user's budget (OPS-4);
  - "Preparing your checkpoint…" until they're ready;
  - the questions are private to that user and book (never in anyone else's quiz or the admin spot-check of public sources);
  - the checkpoint follows Q-P2-26 (5 questions, 60 seconds, 4 of 5, retry);
  - the concepts to mark practiced come from the chapter, tagged by the W3 tagger when the questions are made;
  - missed concepts are due for review.
- Out of scope: book paths shared between users.
- Q: Q-P2-35, Q-P2-38 (a notice at upload).

