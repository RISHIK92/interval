# 0027. One plain, stable explanation per card; tag-derived values shown without an AI label

- Status: ACCEPTED (owner, 2026-10-29: option C, no marker)
- Date: 2026-10-29
- Supersedes: none (amends ADR-0026; amends AI-3 for tag-derived values)
- Superseded by: none

## Context

ADR-0026 (ACCEPTED) put a "Shown for" line on every card, listing every reason that counted. It was worded by a large grammar with playful options, and re-rolled every recompute hour.

**The owner's review of the live output (2026-10-29):** "Exhibit A: your topic picks distributed systems and backend, tagged Rate limiting: XP toward your goal to pass system design interviews, tagged Rate limiting, by way of LLM SDKs in RISHIK92/company-brain, 1 min, coffee-sized and pitched at intermediate". The problems:

- the grammar is unnatural;
- it packs in too much: topic, goal, concept, project, time and level;
- reading time and level repeat the card;
- the variation is artificial ("Exhibit A", "by way of", "coffee-sized");
- it doesn't prioritise.

**The owner's direction:**

- One primary explanation: the project connection first, then a learning goal.
- 2–3 natural templates per category.
- Facts and presentation kept separate.
- Nothing repeated from the card.
- No forced uniqueness.
- Stable wording unless the facts change: "the hourly recompute shouldn't automatically mean the wording must change hourly".
- Difficulty and topic as small labels on the card.
- Playful lines are welcome if they don't feel artificial.
- Fallbacks when no project or goal applies: exploration phrases (owner's ten), split so that novelty is claimed only on actual exploration picks (REC-4), and neutral phrases elsewhere.
- **Tag-derived values (the concept a project or goal line names, the difficulty label) shown as plain text with no AI marker.**

**The rule that last point changes:**

- AI-3: "Grounded and labeled."
- CLAUDE.md's invariant: AI output "is always labeled in UI (AI-3, AI-1)".
- The concept and the difficulty come from the model tagger (or an admin's correction). Showing them unlabelled is a change to AI-3, which only an accepted ADR can make.

## Options

### A. Keep ADR-0026 (every reason, a large grammar, re-rolled hourly)

- **Pros:** complete; every reason is visible.
- **Cons:** the problems the owner listed; the lines are long; wording changes every hour.
- **Cost to reverse:** none.

### B. One explanation per card, and the tag-derived concept carries a subtle "AI tag" marker

- **Pros:**
  - plain sentences, as in C;
  - AI-3 stays as written.
- **Cons:** a UI marker the owner chose against.
- **Cost to reverse:** low.

### C. One explanation per card, tag-derived values as plain text (the owner's direction)

- **How it works:**
  - **Choosing the explanation:** the first that holds of project, goal, exploration pick, fresh (within 7 days), trusted (source rated 4+). Otherwise a neutral phrase.
  - **Wording:** 2–3 templates per category (appendix), chosen by a stable hash of (item, category, the facts). The wording changes only when the facts do.
  - **Grammar:** no template puts a verb right after a concept, so singular and plural names both read correctly (concept names have no number in the graph). Repositories show by their short name.
  - **Labels:** difficulty and topic as small labels beside the reading time.
  - **Kept from ADR-0026:** "a reason is wrong" (for the one stated reason), which is now the main safeguard against wrong tags. Lines stay private to the user (they may name a repository), and starter feeds have no project or goal.
  - **Removed:** the playful grammar, "every reason", hourly re-rolls, "+N more" and "tagged".
- **Pros:**
  - readable, prioritised and stable;
  - an exploration pick says so truthfully;
  - the template set is small enough to review in full;
  - no model calls.
- **Cons:**
  - **A wrong tag reads as fact.** For example, the Tailscale card: "Rate limiting is relevant to the LLM SDKs in company-brain" rests on one probably-wrong section tag and an unreviewed seed mapping. The report link and the owner's tag review are what correct it.
  - It amends AI-3.
- **Cost to reverse:** low. The labels and templates are copy and code; the marker in B could be added later.

## Recommendation (not a decision)

**B, or C if the owner accepts the AI-3 change.**

- AI-3 and CLAUDE.md's invariant favour labelling tag-derived values. B keeps the plain sentences and adds only a marker.
- The owner chose C, knowing the trade-off: a wrong tag reads as fact, and reports are the safeguard.
- Either way, the rest of C fixes every problem the owner listed.

**What would change this:** wrong-tag reports piling up would argue for B's marker.

## Consequences

- **Amends ADR-0026:** one explanation per card, from the appendix's templates, stable per card and facts. The ADR-0026 grammar, its playful options, the hourly re-roll and "every reason" are retired. `reasons` holds the one sentence and `reason_kinds` its one kind (empty for a neutral phrase). "A reason is wrong" offers that one reason.
- **Amends AI-3** (and CLAUDE.md's invariant, which the owner edits) for values derived from model tags shown as card attributes: the concept named in a project or goal line, and the difficulty label. These show without an AI label. Model-written text (the AI project line, P2-W12-S05) stays labelled.
- **Web:** small difficulty and topic labels on moment and article cards. Difficulty comes from the item's tags, the admin's correction first.
- **Unchanged:**
  - the ranking;
  - the fact checks (a reason is stated only when its facts hold);
  - the AI project line and its first place in the feed;
  - starter feeds without project, goal or repository.

## Open questions

- **The copy:** the owner reviews the full template set below, in `workers/jobs/seeds/reasons.yaml` once built.

## Appendix: the templates (draft), with real examples

`{concept}` is a concept name, singular or plural; no verb follows it directly.

**Project** (facts: technology, repositories, concept):

1. "Relevant to the {technology} in {repositories}: {concept}." → "Relevant to the LLM SDKs in company-brain: Rate limiting."
2. "In {repositories}, you use {technology}. This one covers {concept}." → "In codit, company-brain and 1 more, you use Next.js. This one covers Content delivery networks."
3. _(playful)_ "Spotted {technology} in {repositories}. This one's about {concept}." → "Spotted PostgreSQL in velox. This one's about Transactions."
4. _(playful)_ "Homework for {repositories}: {concept}." → "Homework for company-brain: Rate limiting."

**Goal: pass system design interviews** (facts: concept):

1. "System design interviews ask about {concept}." → "System design interviews ask about Rate limiting."
2. "Good prep for system design interviews: {concept}." → "Good prep for system design interviews: Approximate nearest neighbour indexes."
3. _(playful)_ "An interviewer will ask about {concept} someday. Be ready."

**Goal: get better at the stack you use** (facts: concept):

1. "Part of the stack you use: {concept}."
2. "For the stack you use: {concept}."

**Exploration pick** (no facts; owner's phrases):

1. "A new direction to explore."
2. "Something different to dig into."
3. "Expand your perspective."
4. "Explore beyond your usual topics."
5. "Broaden your technical horizons."
6. "Discover a different approach."
7. "Take a look beyond the familiar."

**Fresh** (fact: source):

1. "New this week from {source}." → "New this week from Tailscale Blog."
2. "Fresh from {source} this week."

**Trusted** (fact: source):

1. "From {source}, one of the best-rated sources here."
2. "{source} is one of the best-rated sources here." _(the source is a single name)_

**Neutral** (no facts; on any other card):

1. "Worth exploring."
2. "A fresh angle to consider."
3. "An idea worth investigating."
4. "Worth a look."
5. "Could be useful."
