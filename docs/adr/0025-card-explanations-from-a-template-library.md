# 0025. Card explanations from a deterministic template library, not model polishing

- Status: ACCEPTED (owner, 2026-10-29)
- Date: 2026-10-29
- Supersedes: none (amends REC-5 and Q-P1-18's polish step)
- Superseded by: none

## Context

Every feed card shows a "Why this matters" line. It comes from one template per top ranking signal (P1-W4-S06). If `NOTES_MODEL` is set, a model polishes each template once.

**What the decisions say:**

- REC-5: "Explanations come from the top ranking signal, using a template polished by a small model, and are cached."
- Q-P1-18 (answer, owner 2026-10-25): "template per top signal type, filled per (item, signal); polished once by the small model and cached per (item, signal type, level); labeled 'AI' in UI".
- AI-2 lists notes among the small model's jobs, and AI-4 says to "generate once per item, personalize lightly".
- §5E: "Short, labeled notes generated from the ranking signal and the user's project context. For example: 'Your billing-api runs FastAPI on PostgreSQL. This is the limit you'll hit first.'"

**What the owner found in use (2026-10-29):**

- **Notes repeat the card:**
  - "Sized for your 3–8 min break." sits under the card's own "Fits your 3–8 min break".
  - On project cards, the shared "Uses PostgreSQL, from your projects." sits beside the personal AI project line (P2-W12-S05).
- **Wording is the same everywhere:** one template per signal, so every card with the same top signal reads alike.
- **Polishing costs without adding much:** it spends the global AI budget (OPS-4) to reword generic sentences that carry no new fact. The small model may only rephrase them (AI-1: it sees the title, source and template, never the article).

**The owner's direction (2026-10-29), recorded as Q-P2-45:**

- No LLM polishing of shared notes.
- The personal project line is the main explanation.
- Otherwise, at most one grounded explanation, shown only when it adds something.
- A library of template categories with about 10 templates each, filled from verified data and chosen deterministically, stable across refreshes, without repetition.
- `NOTES_MODEL` is used only for personal project lines.
- Ranking reasons stay stored internally for debugging and ranking evaluation.
- **v1 categories:** project relevance (as the fallback until the AI line exists), learning goal, concept connection, topic interest, fresh, trusted source.
- **Later:** skill progression and practical applications.

REC-5 and Q-P1-18 describe the polish as part of how explanations are made, so removing it needs this ADR (CLAUDE.md: decisions are amended only through an ADR).

## Options

### A. Keep model polishing (status quo)

- **Pros:**
  - matches REC-5 and Q-P1-18 as written;
  - polished wording reads less mechanically.
- **Cons:**
  - spends the global budget on sentences with no new information;
  - every card still shows a line, including ones that repeat the card;
  - polishing one template per signal doesn't add variety in what is said, only in how it's phrased;
  - a refused or over-budget polish leaves the template anyway (LOAD-5), so quality varies with the budget.
- **Cost to reverse:** none; it's what exists.

### B. Templates only, one per signal, no polish

- **How it works:** today's templates without the model; the notes that repeat the card are hidden.
- **Pros:**
  - the smallest change;
  - no model cost;
  - deterministic.
- **Cons:**
  - every card led by the same signal reads identically;
  - only the signal's bare fact is said ("On databases, a topic you chose."), never which concept or how it connects;
  - doesn't meet the owner's direction of varied, grounded explanations.
- **Cost to reverse:** low; the templates are code.

### C. A deterministic template library (the owner's direction)

- **How it works:**
  - A YAML library (`workers/jobs/seeds/explanations.yaml`) of categories with 2–3 templates each (about 15). The information is in the variables, not in the phrasing; more templates come only if repetition shows up in use. Placeholders are filled only from stored data:
    - the source name;
    - the item's tagged concepts (the admin's correction wins);
    - a prerequisite of one of them in the concept graph;
    - the user's chosen topic;
    - the goal's words;
    - the technology on a concept from the user's project concepts (P2-W12-S04);
    - the user's level.
  - A template is eligible only when all its placeholders have values.
  - The top signal picks the category: project, goal, topic, fresh or trusted. Level- and time-led cards get a concept connection only when a grounded prerequisite exists, and otherwise nothing.
  - A stable hash of (item, category) picks the template, so a card's wording never changes between refreshes. Nothing depends on neighbouring cards, which would make wording shift when the feed reorders.
  - Concept names come from the model tagger's tags, so a wrong tag would become a visible claim. Goal and project notes name a concept only as the reason for the pick ("for your goal: system design interviews (caching)"), not as a statement of what the article covers. A concept connection states a relation in the curated concept graph ("{concept} builds on {prerequisite}"); the tag behind it is an accepted risk, covered by the tagging evaluation set (AI-5).
  - The personal AI project line wins over any template. The project template names a technology and concept, never a repository, so it stays shareable.
  - Notes stay shared in `feed_note`, with no model and no AI label.
- **Pros:**
  - no model cost for shared notes (OPS-4);
  - varied wording that says _which_ concept or technology connects;
  - nothing about the article's content is invented (AI-1), since every value comes from tags, the graph or the user's own choices;
  - deterministic and testable;
  - fewer lines on screen;
  - matches §5E's "from the ranking signal and the user's project context", with the context-heavy line left to the AI project note.
- **Cons:**
  - the template copy is the owner's to review;
  - variety is bounded by the library, and some combinations will read oddly until the copy is tuned;
  - fragment composition and repetition across sessions are left for later;
  - concept names rest on the tagger's accuracy.
- **Cost to reverse:**
  - Low to moderate. Notes are regenerated on every recompute, so switching back to polishing means restoring the polish stage and queue.
  - Removed code is in git history.

## Recommendation (not a decision)

**C.**

- The owner's direction (Q-P2-45) asks for it, and the docs support it:
  - §5E describes notes "generated from the ranking signal and the user's project context", which C fills from both. The AI project line (P2-W12-S05) carries the personal context §5E's example shows.
  - OPS-4 asks for cost control, and polishing generic sentences is spend without new information.
  - AI-1 is better served when the only model-written line is the project line, which is grounded in repository metadata.
- REC-5's first clause, "Explanations come from the top ranking signal ... and are cached", still holds. Only "using a template polished by a small model" is replaced.

**What would change this:** owner review finding the template copy worse than polished text. Then polish could return for the shown categories only, which is option A, narrowed.

## Consequences

- **Amends REC-5:** "using a template polished by a small model" becomes "using a deterministic template library filled from grounded data". The rest of REC-5 stands.
- **Amends Q-P1-18:** the polish step and its "AI" label go. Already-polished rows keep their text and label, since they are true model output, until they're no longer used.
- **Amends AI-2's mention of notes:** the small model writes personal project lines only.
- **Removed:**
  - the `polish_note` stage, message schema and queue (both stacks; nothing is deployed, ADR-0013);
  - recompute-due's polish queuing and its infra grant;
  - the polish function and prompt.
- **Added:**
  - `workers/jobs/seeds/explanations.yaml` (PROVISIONAL, the owner reviews the copy);
  - `feed/explain.py` (loading, variables, selection);
  - tests for grounding, category rules and determinism.
- **Web:** a card shows the AI project line alone when it exists, otherwise the template note when there is one.
- **Kept:** `top_signal` and the score breakdown on every feed entry, for debugging and ranking evaluation.

## Open questions

- **Template copy:** the owner reviews and edits the YAML.
- **v2:**
  - skill progression (needs the user's mastery states in the recompute);
  - practical applications (needs a grounded source);
  - fragment composition;
  - repetition across sessions.
- **The in-app reader's note** follows the same rule. Whether it should also show the AI project line is left for later.
