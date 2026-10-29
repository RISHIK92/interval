# Phase 2 questions

Gaps, ambiguities and underspecified points that block or risk Phase 2 (docs/roadmap/phase-2.md). Each has a suggested default that applies only if the owner accepts it. None of the defaults are decisions. Questions are added week by week as each week starts.

Priority: **P0** blocks the week's first slice; **P1** blocks a later slice; **P2** a risk, not a blocker.

## Week 7: notes and the mastery table

### Q-P2-01 What a note attaches to (P0)

- Cite: §5I ("The library holds saves, notes, highlights…"), §5D (the native reader's "note" control), §3.1 (learner state "updated by reading, notes, quizzes, and games"), Phase 2 Week 7 ("notes").
- Why it matters: the docs name notes but never say what one is attached to, who sees it, or where it is written.
- **Answer (owner, 2026-10-27):** a private free-text note on a moment or a whole article, kept with its URL and attribution; listed under Library → Notes and on the card. Highlights wait for the native apps: the PWA cannot select text on the publisher's page.
- Suggested default (D3, not yet confirmed): written from a note box on the reader page (`/read/[item]`) and on Home's Now reading panel, where the user has just read; at most 2,000 characters; editable and deletable; one note per user per moment or article.

### Q-P2-02 Which reading events count as mastery evidence (P0)

- Cite: PER-2 ("Mastery is a probability updated by evidence. Reading counts weakly"), Phase 2 Week 7 ("the mastery table updated by reading").
- Why it matters: opening, finishing and writing a note are all "reading" in some sense.
- **Answer (owner, 2026-10-27):** finishing only. A moment finish (return prompt or Mark section done) raises that moment's tagged concepts; an article finish raises the article's tagged concepts. Opening does not count; an untagged item changes nothing.
- Suggested defaults (not yet confirmed):
  - D1, the update: `p ← p + 0.1 × (1 − p)` per new finish, never above 0.3 from reading alone. One finish counts once (the finish row's primary key already makes a repeat a no-op).
  - D2, which concepts: an admin's correction replaces the model's tags, as ranking already does (P1-W3-S05).

### Q-P2-03 How the probability maps to learner states before quizzes (P0)

- Cite: §3.1 (unseen, explored, practiced, mastered, due for review), PER-2, glossary "Learner state", Q-P1-05.
- Why it matters: the mapping is unspecified, and quizzes (Week 9) and checkpoints (Week 10) don't exist yet.
- **Answer (owner, 2026-10-27):** reading caps at explored. No evidence is unseen (no row); any reading evidence is explored. Practiced and mastered need quizzes or checkpoints. The probability is stored now so quizzes can build on it.

### Q-P2-04 Where mastery shows or is used in Week 7 (P1)

- Cite: §5I (knowledge map), REC-1 ("concept gaps"), PER-1 (three layers that never overwrite each other), Q-P1-05.
- **Answer (owner, 2026-10-27):** shown on Profile as the concepts the user has explored. Ranking keeps its Phase 1 seen-concepts rule (Q-P1-05). Profile's "reset inferred" does not wipe mastery: PER-1 keeps mastery a separate layer.

### Q-P2-05 Section-by-section reading credits more than one article finish (P2)
- Cite: Q-P2-02 (each new finish counts), D1, Q-P1-35 (the last section's finish finishes the article).
- Why it matters: an article read section by section credits each section's concepts once per section, then the article's concepts again when the last section completes it. One "Mark article done" credits the article's concepts once. A concept tagged on the article and on n sections gets n + 1 weak bumps one way and 1 the other. Reading still caps at explored and 0.3, so the difference only shows in the probability quizzes later build on.
- Suggested default: keep it (as built in P2-W7-S01). Section-by-section reading is more evidence; the cap bounds it.

### Q-P2-06 Retired concepts on Profile (P2)
- Cite: Q-P1-04 (retired concepts are never deleted; tags are migrated by script), Q-P2-04.
- Why it matters: a concept retired or merged after a user explored it would still be listed, under its old name.
- Suggested default (as built in P2-W7-S02): hide it, as crediting already skips retired concepts (P2-W7-S01). Folding a merged concept into its target waits for the knowledge map.

## Week 8: generator-validator questions, spot checks, difficulty

### Q-P2-07 The validator model (P0)
- Cite: Q-1 ("a second model answers it without the key; mismatches are rejected"), §6.8.
- **Answer (owner, 2026-10-27):** the same free Nemotron, in a fresh call that never sees the key. Q-2's spot checks are the backstop for a model agreeing with its own mistakes.

### Q-P2-08 Question format and count (P0)
- Cite: Q-1, §6.2 (question types).
- **Answer (owner, 2026-10-27):** multiple choice, 4 options, one correct, 2 per moment. Other §6.2 types come with Play.

### Q-P2-09 Which moments get questions (P0)
- Cite: §3.1 ("every question tests one or more concepts"), ING-2.
- **Answer (owner, 2026-10-27):** tagged moments only, under full-text rights.

### Q-P2-10 The question model (P0)
- Cite: AI-2 ("A stronger model handles … question generation, judging"), OPS-4.
- **Answer (owner, 2026-10-27):** the free `nvidia/nemotron-3.5-super-vl:free` through OpenRouter, run as an unimportant background task: a rate limit or an error retries in 5 minutes, and every success is saved, while other work goes on. Overrides AI-2's "stronger model" for now.
- Suggested defaults (as built in P2-W8-S01, not yet confirmed): a reply that breaks a rule (not JSON, a citation that isn't the passage's) also retries in 5 minutes, but stops after 5, so a moment the model can't do doesn't spend the free tier's daily requests forever; one retry chain per moment (a re-tag or backfill while a retry waits is dropped); a redraft (new text, concepts or prompt) retires the old questions rather than deleting them.

### Q-P2-11 Difficulty before there are answers (P1)
- Cite: Q-3 ("recalibrated from real answers using item response theory"), Phase 2 Week 9 (quizzes).
- Why it matters: there are no answers until Week 9's quizzes.
- Suggested default: a question starts at its moment's difficulty (an admin's correction winning); Week 8 stores that and the counts IRT needs; the recalibration job comes in Week 9 with real answers.

### Q-P2-12 The citation (P1)
- Cite: Q-1 ("with a citation"), AI-3 (cites its source passages; stored separately), ING-2, §3.2 (deep links, never copies).
- Suggested default: a verbatim quote of at most 300 characters from the moment's text, stored with the question for validation and review only; users see the deep link to the section, never the quote.

### Q-P2-13 Questions through the batch API (P1)
- Cite: Q-P2-10, AI-4 ("Offline jobs use batch processing"), OPS-4.
- **Answer (owner, 2026-10-27):** draft and validate with `anthropic/claude-haiku-5.5` through OpenRouter's Batch API, at the batch tier's half price ($0.05 / $0.25 per 1M tokens): "batch path costs literally half". Set as `QUESTIONS_MODEL=batch:anthropic/claude-haiku-5.5`; the free per-moment path stays for a non-`batch:` model.
- **Update (owner, 2026-10-27):** after a 10-moment trial of both on the same moments (DeepSeek 10/10 drafted, 20/20 validated, $0.0029; Haiku 9/10, 18/18, $0.0032): "use deepseek". `QUESTIONS_MODEL=batch:deepseek/deepseek-v4.1-flash` ($0.05 / $0.15 per 1M on the batch tier).
- Suggested defaults (as built in P2-W8-S05): `question-batches` every 30 minutes collects, then submits; a failed batch frees its items; a broken reply counts toward the cap of 5 (drafts per moment, validations per question); up to 1,000 requests per batch; Haiku's reasoning effort low (its thinking is billed as output).

## Week 9: test yourself, mastery from quizzes, the review queue

### Q-P2-14 What a Test 60s quiz contains (P0)
- Cite: Phase 2 Week 9 ("the 60-second 'test yourself' after moments and articles"), §5D, wireframes 03 (variant `end`: "test or continue") and 12 (variant `test`: "Each answer gets instant feedback"), §6 (60-second sprint: "Most correct in 60 seconds").
- **Answer (owner, 2026-10-27):** a sprint: questions on the moment's concepts keep coming until 60 seconds run out, as many as the user answers.
- Suggested defaults: the moment's own live questions first, then other live questions on the same concepts; after an article, the concepts of all its moments; no question twice in one quiz; instant feedback after each answer (right or wrong, and the right option); the server holds the clock (a quiz ends 60 seconds after it starts, with a few seconds' grace for the last answer in flight); offered only when the moment or article has at least one live question; the quiz ends early when the questions run out.

### Q-P2-15 How quiz answers move mastery (P0)
- Cite: PER-2 ("quizzes and games count strongly"), §3.1 (unseen, explored, practiced, mastered, due for review), Q-P2-03, §8 ("how many concepts reach mastered").
- **Answer (owner, 2026-10-27):** a correct answer moves p ← p + 0.3(1 − p), a wrong one p ← 0.7p, per concept the question tests. Practiced at p ≥ 0.5; mastered at p ≥ 0.85 with at least 2 correct reviews on separate days. Reading's cap at 0.3 stays.
- **Update (owner, 2026-10-28):** "correct reviews on separate days" means any correct answer on the concept (Test 60s now, reviews from P2-W9-S05) on two different UTC days, so mastered is reachable before the review queue exists. A wrong first answer on a concept is evidence too: it shows as explored, at p = 0 (owner, 2026-10-28).
- Suggested defaults: the state follows the probability both ways (a wrong answer can move mastered back to practiced, or practiced back to explored), so the stored state is never out of step with p; reading never lowers a state a quiz earned.

### Q-P2-16 What FSRS schedules (P0)
- Cite: PER-2 ("FSRS schedules reviews"), §5I ("The review queue is scheduled by FSRS and fed by reading, quizzes, games, and checkpoints"), glossary "FSRS", "Review queue".
- **Answer (owner, 2026-10-27):** one review card per user and concept, created by a quiz answer on that concept; a review asks a live question on the concept, and right or wrong rates it Good or Again. Scheduling uses the `ts-fsrs` library in the web app (owner-approved dependency).
- Suggested defaults: one rating per concept per quiz or review (all its answers right: Good; any wrong: Again); "due for review" means the card is due now, shown alongside the mastery state rather than replacing it; reading doesn't create cards in Week 9 (§5I's "fed by reading" comes when reading has a question to ask); default FSRS parameters (90% target retention) until there are answers to fit them to.

### Q-P2-17 Review slots in the feed (P1)
- Cite: Phase 2 Week 9 ("review slots in the feed"), REC-1 ("due reviews"), §5B ("due reviews" among feed items), wireframe 08 ("The review queue is the top card, with a count, where items came from and a time estimate").
- **Answer (owner, 2026-10-27):** when anything is due, one card ("Review N concepts · ~1 min") in position 2 of the feed, linking to the Library's review queue. Ranking otherwise unchanged.
- Suggested defaults: the card is added when the feed is served (due reviews change by the minute; precomputed feeds don't); a review session asks one question per due concept, the most overdue first, up to 10, untimed, with the same question card and instant feedback; the Library's review queue is its top card, with the count, the concepts and a time estimate.

### Q-P2-18 Flagging a question (P1)
- Cite: Q-2 ("plus everything flagged"), §7 ("Questions that get flagged or behave oddly are pulled for review"), Phase 2 "done when" ("under 2% of questions get flagged").
- Suggested default: a Flag control on each answered question, with a reason (wrong answer key, unclear, not in the section, other); a flagged question leaves quizzes and goes to the spot-check queue (P2-W8-S03), and Keep there puts it back; one flag per user per question; an event for the metric.

### Q-P2-19 Recalibrating difficulty (P1)
- Cite: Q-3 ("Difficulty is recalibrated from real answers using item response theory. Anomalies are pulled for review.").
- Suggested default: a weekly Python job fits a one-parameter (Rasch) model to the answers and moves a question's level once it has at least 30 answers; a question almost everyone gets right (over 98%) or wrong (under 20%) with at least 30 answers goes to the spot-check queue. Until then the starting difficulty (Q-P2-11) stands.

### Q-P2-20 Quiz events (P1)
- Cite: DB-5, Phase 2 "done when" (30% of finished moments lead to a quiz; quiz takers return more often than non-takers), Q-P1-20.
- Suggested default: `quiz_started` (moment or article, or review), `quiz_answered` (question, correct, time to answer), `quiz_finished` (answered, correct), `question_flagged`; metric queries for the two "done when" lines next to the Phase 1 ones.

### Q-P2-21 Week 9's overnight defaults to confirm (P1)
- Cite: Q-P2-14..19, PER-2, Q-2, Q-3, REC-1, §5B; docs/progress.md, 2026-10-28 overnight entries.
- Built on suggested defaults while the owner slept (owner: "use them"); each is easy to change:
  1. FSRS short-term steps off: a concept first comes back in days, not 10 minutes after the quiz (Q-P2-16 said default parameters).
  2. A review idle for 30 minutes since its last question is over: closed then, answered concepts rated, the next review takes the due list fresh (Q-P2-17 is silent).
  3. With an empty feed, no review card shows (Q-P2-17 says position 2; there is none). Should it show alone?
  4. Difficulty levels: below −0.5 logits beginner, above +0.5 advanced, a typical user at 0 (about 62% and 38% right) (Q-P2-19 is silent on the mapping).
  5. Anomalies (over 98% or under 20% right, 30+ answers): queued once, never again after an admin decides one; they stay in quizzes while waiting, unlike flagged questions (Q-3: "pulled for review").
  6. A question flagged by someone else while it's another user's open question can still be answered and count toward mastery, as with retiring (Q-2).
  7. Metric definitions: a finished moment "leads to a quiz" when its user starts Test 60s on it within a day either side; the flag rate is over answered questions, all time to yesterday; quiz return compares last full week's takers and non-takers on the following week (Phase 2 "done when").
- **Answers (owner, 2026-10-28):** 1 yes (days); 2 yes (30 minutes idle); 3 show the review card alone on an empty feed (changed: built); 4 yes (±0.5 logits); 5 yes (stay in quizzes, queued once); 6 yes (still counts); 7 keep the metric definitions as built.

## Week 10: topic paths, launch paths, checkpoints

### Q-P2-22 What a topic path is made of (P0)
- Cite: §5F ("ordered sections built from moments across sources"), glossary "Topic path", DB-2 (prerequisite edges), wireframe 05 ("Books and topics split into sessions, with checkpoints between sections").
- **Answer (owner, 2026-10-28):** a path covers a set of concepts. Each section is one concept (or a small group), ordered by prerequisites; its sessions are tagged moments on that concept from different sources; a checkpoint follows each section.
- Suggested defaults: 2 to 4 sessions a section, one moment each, from different sources where there are, preferring moments the reader can frame and moments with live questions (so the checkpoint has something to ask); only moments the source's rights allow (ING-2); a section with no usable moment is left out of the proposal.

### Q-P2-23 Approval and user edits (P0)
- Cite: §5F ("An LLM proposes the order from concept prerequisites, and a person approves it"), C-25 (HTML: "pause, reorder, skip or change a path from the Edit control").
- **Answer (owner, 2026-10-28):** the owner approves each path's order on an admin page (reorder, edit, approve) before it goes live. Users get full edits on their own copy: pause and resume, reorder sections, skip a section, swap a session's moment for another on the same concept. Resolves C-25.
- Suggested defaults: a reordered section whose prerequisites now come later shows a warning but is allowed; a skipped section gives no practiced credit and unlocks the next; a user's edits never change the approved path, and a path the owner edits later keeps users' progress on sections that still exist.
- **Update (owner, 2026-10-28, P2-W10-S05):** a skip can be undone: Unskip brings the section's checkpoint back, and the sections that opened because of the skip stay open. Implementation defaults: a moved section shows "Moved ahead of <concepts>, which this path teaches first" when it now precedes a section the approved order put first (the approved order is the prerequisite order, §5F); a swap offers up to 5 other moments on the section's live concepts, rights allowing and link working, only for an unfinished reading, the approved moment always first while swapped away (to swap back); a swapped moment whose source's rights no longer allow it gives way to the approved one, and comes back if they do (ING-2).

### Q-P2-24 The launch paths (P0)
- Cite: Phase 2 Week 10 ("5 to 8 launch paths").
- **Answer (owner, 2026-10-28):** the model proposes about 10 candidate paths from the concept graph and the moments we have (name, concepts, why); the owner picks 5 to 8 on the admin page.

### Q-P2-25 The path model (P1)
- Cite: AI-2, OPS-4, ADR-0008, Q-P2-13.
- **Answer (owner, 2026-10-28):** DeepSeek V4.1 Flash through OpenRouter (synchronous; a handful of calls), under the $0.80/M output cap.

### Q-P2-26 Checkpoints (P0)
- Cite: §5F ("60-second quizzes between path sections. Passing marks those concepts as practiced and unlocks the next section. Missed concepts go to the review queue."), wireframe 12 variant `cp` ("Pass 4 of 5 to unlock Partitioning").
- **Answer (owner, 2026-10-28):** 5 questions on the section's concepts, 60 seconds, pass with 4 of 5. Passing marks those concepts practiced and unlocks the next section; missed concepts go to the review queue (due now); failing allows a retry.
- Suggested defaults: questions from the section's own sessions' moments first, then other live questions on its concepts; "marks practiced" raises a concept to at least practiced (p at least 0.5) and never lowers one already mastered; answers also move mastery as Test 60s answers do (P2-W9-S03); a retry draws questions not asked in the last attempt where it can; a checkpoint is offered once every session in the section is finished or skipped.
- **Update (owner, 2026-10-28, P2-W10-S04):** a section with fewer than 5 live questions asks what it has and passes with all but one (at least 1); a section with none shows "Checkpoint not ready yet". The size and pass mark are fixed when the checkpoint starts, so running out the clock doesn't lower them. A reading whose link is broken (ING-6) doesn't hold the checkpoint back (implementation default; the broken-link question from S02 is still open).

### Q-P2-27 Following a path (P1)
- Cite: §4 (Paths tab), §5B (feed items), REC-1 ("continue items"), wireframe 05.
- **Answer (owner, 2026-10-28):** the Paths tab lists the approved paths; Start makes one the user's active path (one at a time; starting another pauses the current one); its next session shows as a card in the feed.
- **Update (owner, 2026-10-28):** a path the owner retires stays, read-only, for those who followed it: marked Retired in their Paths tab with their progress, paused (out of the feed, never resumed), and they can start another.
- Suggested defaults: the path's next-session card is the feed's first card (before the review card), saying why ("Next in your path: Replication, session 3 of 3"); the Paths tab shows the active path's timeline (sections, sessions, checkpoints with the pass mark and what they unlock, locked sections saying what unlocks them), as wireframe 05.

### Q-P2-28 Path events and the continuity metric (P1)
- Cite: DB-5, §8 ("Continuity: path progress"), Q-P1-20.
- Suggested default: events `path_started`, `path_paused`, `path_section_skipped`, `checkpoint_started`, `checkpoint_finished` (passed or not, correct); a metric query for path progress (sections passed per active path per week).
- Note (P2-W10-S04): a checkpoint left open (the tab closed) is closed and settled at its clock by the user's next quiz start, with no `checkpoint_finished` event, as with `quiz_finished` since W9. S06's progress query should count passes from the database, or that close should emit; to decide in S06.
- **Answer (owner, 2026-10-28, P2-W10-S06):** emit on that close: a start that closes quizzes left open records their `quiz_finished` / `checkpoint_finished` first, which also fixes the Week 9 quiz metrics. The progress query (`path_progress.sql`) counts passed sections per active path in the last full week, by beta group. Known limit: no event marks a path finished or retired, so a finished path counts as active (0 a week) until paused or replaced.

### Q-P2-29 Skip what you know (P1)
- Cite: §5F (paths), PER-1 ("Explicit user choices always override inferred interests"), PER-2 (mastery), Q-P2-23 (skip).
- **Answer (owner, 2026-10-28):** suggest skipping a section when every one of its concepts is mastered for the user (not merely practiced). The path page shows the suggestion with Skip and Keep; the feed's path card, on such a section, adds "You know this" and a Skip button. Nothing is skipped without a tap.

### Q-P2-30 Missing-foundation warning (P1)
- Cite: §5F (paths ordered by concept prerequisites), the concept graph (`concept_edge`, Q-P1-04).
- **Answer (owner, 2026-10-28):** a missing foundation is a direct (one-hop) prerequisite of a section's concepts that isn't in the path and that the user has never explored. It shows on each open section of the path page ("Builds on X, which you haven't read yet", with one reading on X) until the user has explored X; no dismiss, no prompt on Start.
- Suggested defaults: at most 3 foundations per section, fewest first by name; the reading follows the swap list's rule (rights allowing, link working, newest first) and opens as a path open; a section the user skipped shows none.

### Q-P2-31 The book reader (P0)
- Cite: §5F ("an in-app reader saves position"), C-11.
- **Answer (owner, 2026-10-28):** the reader shows the book's extracted text, split into sessions sized to the break length, like moments; the position is the session and the scroll within it. No PDF page rendering.
- **Update (owner, 2026-10-28, P2-W11-S04):** reversed: the reader shows the section's own PDF pages (PDF.js), so diagrams, tables and code stay as printed; each session is a page range. The extracted text stays in the database for the checkpoints (S06) and is not shown (owner removed the "Show the text" disclosure the same day). Only the reader's scrolling moves the saved place; opening a section doesn't.

### Q-P2-32 OCR engine (P0)
- Cite: ING-5 ("Textract OCR for scanned pages"), ADR-0011, ADR-0013.
- **Answer (owner, 2026-10-28):** Tesseract in its own Docker container with a 512 MB memory cap, as a separate OCR service the worker calls; jobs queue on the existing Valkey. Digital pages use the PDF's own text; only scanned pages are OCR'd. Recorded as ADR-0022 (PROPOSED), since it amends ING-5.

### Q-P2-33 Where books live (P0)
- Cite: §4 ("Paths: topic paths and books"), §5F.
- **Answer (owner, 2026-10-28):** the Paths tab ("Your books") and the feed (the next session as a card), with chapter checkpoints this week.

### Q-P2-34 Upload limits (P1)
- Cite: OPS-3, OPS-4, DB-6.
- **Answer (owner, 2026-10-28):** 50 MB and 1,000 pages per file, 5 books per user, as entitlement limits; encrypted (DRM) PDFs refused.

### Q-P2-35 Book checkpoints (P1)
- Cite: §5F (checkpoints), Q-P2-26.
- **Answer (owner, 2026-10-28):** per chapter, generated on demand when the user reaches the chapter's end, so unread chapters cost nothing; the same rules as topic path checkpoints.
- **Update (owner, 2026-10-29, P2-W11-S06):** a book's chapters don't lock: the checkpoint is offered at the chapter's end and records its result (concepts practiced, misses due for review), but the next chapter is always open, and a passed checkpoint can be taken again. Concepts come from the W3 decision tagger run on the chapter's sessions (at most 6, spread through it); the user meets the checkpoint at the chapter's end page and on the Paths timeline.

### Q-P2-36 The "Finally finish that book" goal (P2)
- Cite: ADR-0015.
- **Answer (owner, 2026-10-28):** enable it once books ship; choosing it leads to adding a book.

### Q-P2-37 New dependencies (P1)
- Cite: CLAUDE.md ("No new dependency without asking").
- **Answer (owner, 2026-10-28):** pdfplumber in the worker (not PyMuPDF: AGPL); `@aws-sdk/client-s3` in the web app for the upload. No presigner: uploads go through the web server.
- **Update (owner, 2026-10-28, P2-W11-S04):** `pdfjs-dist` (6.4.299) in the web app, loaded only by the reader.

### Q-P2-38 Private book text and the model provider (P0)
- Cite: ING-5 ("a private pipeline"), AI-3, ADR-0007, ADR-0008, Q-P2-35.
- Question: book checkpoints (S06) need the chapter's text sent to the model provider (OpenRouter's DeepSeek, as the W8 generator uses) to write and check questions, and to tag concepts. Is that acceptable for private uploads, and with what conditions (a provider with zero data retention, a notice at upload, opt-in per book)?
- Suggested default: allowed through the gateway only, with a one-line notice at upload ("Checkpoints send a chapter's text to our AI provider to write questions"), and only providers that don't train on or retain API data.
- **Answer (owner, 2026-10-28):** allowed through the gateway only, with a one-line notice at upload, and only providers that don't train on or retain API data.
- **Update (owner, 2026-10-29, P2-W11-S06):** book checkpoints use the same `QUESTIONS_MODEL` without a zero-data-retention flag ("its okay"), and the W3 tagger (Voyage embeddings, OpenRouter's decision model) also sees the chapter's text. Still only through the gateway, on the owner's budget; the notice at upload names "our AI providers".

### Q-P2-39 Books and guests; files when an account goes (P1)
- Cite: §5F, DB-6, ING-5; the P2-W11-S01 review.
- **Answer (owner, 2026-10-28):** books are for accounts only: a guest sees "Create an account to add a book". When an account is deleted, its files under `books/<user>/` are removed too (the worker's `remove_file`, retried). There is no account deletion flow yet; whatever builds it must queue that removal.


### Q-P2-40 How often a connected user's repositories are read (P1)
- Cite: §5H, ADR-0024 (open question), LOAD-5.
- Suggested default: on connect, by a "Refresh" button in Profile, and daily for users active in the last 7 days (like the hourly feed recompute's "active").
- **Answer (owner, 2026-10-29):** the suggested default.

### Q-P2-41 Which dependency files count (P1)
- Cite: §5H ("package.json, requirements.txt, go.mod"), ADR-0024 (open question).
- Suggested default: package.json, requirements.txt, pyproject.toml and go.mod, at a repository's root and one directory down (monorepos); lockfiles ignored; dev dependencies counted (they're part of the stack); repositories that are forks or archived skipped.
- **Answer (owner, 2026-10-29):** the suggested default.

### Q-P2-42 The technology seed and suggestions (P1)
- Cite: PER-4 ("A curated table maps technologies to concepts. An LLM can suggest additions, which you review."), §5H.
- Suggested default: a seed of about 60 common technologies across npm, PyPI and Go (frameworks, databases and their drivers, queues, caches, ORMs, cloud SDKs), each mapped to 1–4 existing concepts, drafted by me for your review like the concept seed; suggestions for unclaimed packages used by at least 2 users (or 1 while the beta is small), reviewed on an admin page.
- **Answer (owner, 2026-10-29):** the suggested default (a seed of about 60 drafted for review; LLM suggestions accepted or rejected on an admin page).
- **Answer (owner, 2026-10-29):** (update, owner 2026-10-29, after the S03 review) only public-looking package names go to the model provider from a single user's repositories: npm scoped packages and Go modules off the public hosts are sent only when 2+ users share them.

### Q-P2-43 Projects' weight, and what project-aware notes send (P1)
- Cite: REC-1, PER-1, ADR-0015, AI-5, OPS-4.
- Suggested default: the projects generator adds candidates with their own `ranking_config` weight (starting like the concept-gap weight), never above an explicit topic choice; the notes model gets the repository's name, description and matching technologies only (owner: never code), once per user, moment and repository set.
- **Answer (owner, 2026-10-29):** the suggested default for the weight: the projects generator gets its own `ranking_config` weight, starting equal to the concept-gap weight, tunable on the admin ranking page, never above an explicit choice (PER-1). (What notes send: never code, as already decided.)

### Q-P2-44 Token signing in the worker (P1)
- Cite: CLAUDE.md ("No new dependency without asking"), ADR-0024 (open question).
- Question: minting GitHub App tokens needs an RS256-signed JWT. `cryptography` is already installed (pulled in by another package) and can sign it in a few lines; PyJWT wraps it.
- Suggested default: declare `cryptography` as the worker's direct dependency and sign the JWT with it (no PyJWT).
- **Answer (owner, 2026-10-29):** the suggested default: `cryptography` as a direct worker dependency, no PyJWT.

### Q-P2-45 What a card explains, and whether shared notes are polished (P1)
- Cite: REC-5, Q-P1-18, §5E, AI-1, OPS-4, P2-W12-S05; ADR-0025.
- Question: should every card show a "Why this matters" line, polished by the notes model, or only explanations that add something?
- **Answer (owner, 2026-10-29):**
  - **No polishing:** no LLM polishing of shared notes. `NOTES_MODEL` is used only for personal project lines, which win over any other explanation.
  - **Project fallback:** until a project line exists, a project template naming the technology and concept (never a repository) shows.
  - **Other cards:** at most one grounded explanation from a deterministic template library. v1 categories: learning goal, concept connection, topic interest, fresh, trusted source; 2–3 templates each, chosen by a stable hash of the item (owner, after debate: phrasing variety is cosmetic, and neighbour-based choice would change wording as the feed reorders).
  - **Concept names** (from the tagger): named in goal and project notes as the reason for the pick, not as a claim about the article's content.
  - **Level- or time-led cards:** a concept connection from the concept graph when a prerequisite exists, otherwise nothing (owner's choice over my suggestion of nothing in v1).
  - **Kept internally:** the ranking reasons stay stored for debugging and evaluation.
  - **Later:** skill progression and practical applications.
