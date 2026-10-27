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
- Suggested defaults (as built in P2-W8-S05): `question-batches` every 30 minutes collects, then submits; a failed batch frees its items; a broken reply counts toward the cap of 5 (drafts per moment, validations per question); up to 1,000 requests per batch; Haiku's reasoning effort low (its thinking is billed as output).
