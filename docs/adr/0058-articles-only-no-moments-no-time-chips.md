# 0058. Articles only: no moments, no time chips, a quiz per article

- Status: PROPOSED
- Date: 2026-11-27
- Supersedes: none (amends docs/product.md §3.2 and §5A, ING-4, and the glossary's Moment and Time budget; see C-40)
- Superseded by: none

## Context

The product splits articles into moments and sizes the feed to a time budget:

> A **moment** is a self-contained section of an article or book, sized to the time available ("Section 2 of 4 · 3 min"), with a "continue from here" pointer. Longer budgets surface full articles. Progress is tracked per moment, so a moment can grow into a full read. (docs/product.md §3.2)

> **ING-4. Moments are split at headings into 2 to 8 minute sections,** with deep links and a per-source switch to turn them off. (docs/decisions.md)

Onboarding asks for a break length (1–3, 3–8 or 8–15 minutes, §5A), and the feed is ranked once per chip.

On 2026-11-27 the owner asked to "remove duration wise division of articles and remove moments (combine the quizzes we built around moments to whole article), article will only have continue reading, completed". The owner then answered:

- **Depth:** remove moments from the schema too, not only from the UI.
- **Time chips:** remove them.
- **Quiz:** always available on the article, as well as after reading.
- **Model output:** "dont delete the questions and everything we used openrouter llm's, combine them to whole article where required".

## Options

### A. Articles only, schema included (the owner's instruction)

- Pros: one reading unit everywhere (feed, reader, paths, notes, quizzes, history); no segmentation stage, per-moment tagging, per-chip ranking or anchor checks to run; the states are simply "continue reading" and "completed".
- Cons: loses section-level deep links ("continue from here" becomes the article's own link); paths and explainers lose section granularity; a large change across workers, web, mobile, the CLI and the VS Code extension.
- Cost to reverse: high. Moments can be rebuilt by re-running segmentation (the headings stay in `content_item_section`), but per-moment progress and per-moment model output, once combined per article, can't be split back.

### B. Hide moments in the UI only

- Pros: reversible; much smaller.
- Cons: the owner chose against it.
- Cost to reverse: low.

## Recommendation (not a decision)

**A**, because the owner chose it.

## Consequences

**Built expand-then-contract,** so `main` stays green between commits:

1. Add the article-level schema and copy the data across.
2. Switch each part over: workers, web, mobile, CLI, extension.
3. Drop the moment schema last.

**Model output is kept, combined per article. No question, explainer, tag, probability, decision or embedding is deleted:**

- `question`: gains `content_item_id` from its moment. Ordinals are renumbered per article and kind, in moment order, so the one-per-slot rule holds. Drafting and batch rows move to the article.
- `moment_embedding`: averaged per article into a new `item_embedding.embedding`.
- `moment_concept` and `moment_concept_probability`: merged into `item_concept` and `item_concept_probability`, keeping the highest probability per concept. `moment_decision` moves to the article, keeping each model's decision.
- `concept_explainer.citations` and `ask_answer.citations`: point at the article (`content_item_id`) in place of `moment_id`.
- `tag_override` rows for a heading become whole-article overrides; on a clash, the whole-article row wins.

**People's data is kept:**

- **Notes:** a user's notes on one article's sections are joined into that article's note, each under its section title.
- **Opens:** opened and finished moments become `user_article_opened`. An article is completed only where it was already (`user_article_finished`).
- **Paths:** sessions point at the moment's article, keeping the first when two moments of one article sat in the same section.

**Removed:**

- Segmentation (`segment_item`), the moment anchor check (`check-links`; ING-6's whole-page health stays), the per-source moments switch and boundary overrides.
- Per-moment tagging and embedding.
- The break-length chips: onboarding, profile, the feed's per-chip ranking and `time_fit`, Also fits, the review sizing, the CLI's `--chip` and the extension's chip setting.

**Kept:** `content_item_section` (headings and word counts, used for reading time).

**Quizzes:** one per article, sampled from all its questions. "Quiz me" is always on the article, and offered again on Completed. Missed questions go to review as before.

**Reading states:** "Continue reading" means opened and not completed, and opens the article's link. "Completed" is the reader's Done, or the app's auto-finish at the article's end.

**Down migrations:** the contract step can't restore moments, so its down raises.

## Open questions

- How many questions should an article's quiz sample? Default 5, the old quiz length.
- How should Explore's "N-min session", which was built from moments, read now? Default: the top articles for the concept.
