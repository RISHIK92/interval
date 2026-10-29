# 0026. "Shown for" reasons on every card, rendered from the ranking itself

- Status: ACCEPTED (owner, 2026-10-29)
- Date: 2026-10-29
- Supersedes: none (amends ADR-0025)
- Superseded by: none

## Context

ADR-0025 (ACCEPTED) made card explanations a deterministic template library with "at most one explanation per card, and only when it adds something". Q-P2-45's update then dropped the topic category. After that, 2 of 50 cards in the owner's feed carried a line and none of the test account's.

**The case that exposed the gap (owner, 2026-10-29):** a Tailscale Kubernetes post ranked #1 in the owner's 1–3 and 3–8 feeds. The stored score breakdown (`user_feed_entry.score_parts`, P1-W6-S01) showed the reasons:

- topic 1.0 (the source's topics are ones the owner chose);
- goal 1.0 (the item's only concept, rate-limiting, is in the goal "pass system design interviews");
- project 1.0 (the seed maps LLM SDKs, used in RISHIK92/company-brain, to rate-limiting);
- level and break fit 1.0.

The only concept came from one section's tag that is probably wrong. Nothing on the card said any of this, so the owner couldn't tell a good pick from a bad tag.

**What the docs say:**

- REC-5 (as amended by ADR-0025): explanations come from the top ranking signal.
- §5E: "Short, labeled notes generated from the ranking signal and the user's project context."
- PER-1: explicit choices override inferred interests, which users can only check if they can see which was used.
- AI-3: AI output is labelled. Tags are model output, so a reason that rests on a tag should say it's a tag.

**The owner's direction (2026-10-29):**

- A "why this was shown" text, free and accurate, on every card, visible (not behind a menu).
- It lists every reason that counted.
- A user can report a wrong reason in v1.

## Options

### A. Keep ADR-0025 as it is

- **Pros:**
  - the least clutter;
  - nothing to build.
- **Cons:**
  - most cards say nothing, so a pick driven by bad data, like the Tailscale case, can't be seen or reported;
  - the breakdown that explains every pick stays internal.
- **Cost to reverse:** none.

### B. "Why am I seeing this?" on demand, in each card's menu

- **Pros:**
  - every card is explainable;
  - cards stay uncluttered.
- **Cons:**
  - hidden reasons are rarely opened, so bad tags still go unnoticed;
  - the owner chose against it.
- **Cost to reverse:** low.

### C. A compact "Shown for" line on every card, rendered from the breakdown (the owner's direction)

- **How it works:**
  - During the recompute that already runs, each signal above a small weighted threshold (0.1) whose evidence is true becomes a reason: the matched topics, the goal and its concept, the technology with its repository and concept, the level, the minutes, a rated-4+ source, published within 7 days, or "something new" for an exploration pick (REC-4).
  - **Varied wording, without machine learning (owner, 2026-10-29: "many and very random, less likely to repeat"):** a small grammar engine in the Python standard library, built from how data-to-text systems do it:
    - **Grammar (Tracery):** lead-in variants ("Shown for", "Picked because", …), several sentence frames per reason, and shared synonym symbols nested inside the frames, so variety multiplies at each level.
    - **Branches and synonyms (Automated Insights' Wordsmith):** a frame is chosen only when its facts hold.
    - **Aggregation (Reiter and Dale):** reasons stay ordered by weight, same-kind facts merge into one clause ("backend and distributed systems"), and the joining style varies ("A · B · C", "A, B and C", "A, with B and C").
    - **Modifiers:** a/an, plural agreement, natural lists, capitals.
    - **No-repeat choice (RosaeNLG's `once` mode):** within one recompute's feed, the least-used variant is chosen first, so neighbouring cards don't share wording.
    - **Re-roll (owner's choice over a stable-per-card seed):** the seed is (user, item, recompute hour), so each recompute reads fresh and any one is reproducible in tests.
  - **Accuracy check:** every frame of a reason must carry that reason's facts (goal and concept; technology, repository and concept; …). A test expands every variant and checks it, along with no unfilled symbols, determinism per seed, and no full line repeated in a 50-card feed.
  - A neutral prior, such as an unrated source's 0.5 quality, is never stated as a reason.
  - Stored per entry: `user_feed_entry.reasons` (private to the user, so naming the repository is fine) and `starter_feed_entry.reasons` (topic and level only).
  - It replaces ADR-0025's template note. The AI project line (P2-W12-S05) stays as the personal sentence.
  - A "A reason is wrong" report goes to `reason_report`, and `/admin/items` lists reported items first.
- **Pros:**
  - accurate by construction: the line is the ranking's own reasoning, so a wrong tag is visible ("your goal … (rate limiting)") and reportable;
  - free, with no model;
  - the reports give the admin a queue of real tagging and seed errors, feeding AI-5's evaluation set;
  - it supports PER-1, because users see what was inferred.
- **Cons:**
  - a line on every card, which ADR-0025 avoided; mitigated by one compact line, capped at about 4 reasons with "+N";
  - it repeats the break length ("3 min") that the owner removed as "Fits your … break", now as one short reason;
  - a report flow and admin listing to build.
- **Cost to reverse:** low. It's one column and one line; ADR-0025's note can return.

## Recommendation (not a decision)

**C, as the owner directs.**

- PER-1 and AI-3 favour showing what was inferred and that it rests on model tags.
- §5E's "generated from the ranking signal" is met more fully by rendering all the signals than by rendering one.
- The Tailscale case shows the cost of hiding them: a probable tagging error ranked first and couldn't be seen.
- B would avoid the clutter. The owner prefers visibility, and the compact line limits the cost.

**What would change this:** the line proving noisy in use, for example the same three reasons on every card. Then B, or a shorter visible form, becomes the fallback.

## Consequences

- **Amends ADR-0025:** cards carry a "Shown for" line from the ranking breakdown, not one optional explanation. ADR-0025's category templates are retired; `feed_note` keeps its old rows. The library becomes a grammar of reasons. Determinism and grounding stay as they are: no model, and only stored data.
- **Data:**
  - `reasons` on `user_feed_entry` and `starter_feed_entry`, and on both views;
  - `reason_report` (user, item, reason);
  - event `reason_reported` (DB-5).
- **Worker:** `ProjectConcepts` carries each technology's repositories (already returned by `user_technology_concepts`).
- **Web:**
  - the line on moment and article cards;
  - "A reason is wrong" in the card menu;
  - reported items first on `/admin/items`.
- **Unchanged:** the AI project line and its first place in the feed (Q-P2-43 update); `NOTES_MODEL` used only for it.

## Open questions

- **Reason wording:** I draft the grammar (PROVISIONAL), and the owner reviews it.
- **Ranking weaknesses the case exposed:** a single concept scores a full 1.0, and goal and project double-count a concept. Separate from this ADR.
