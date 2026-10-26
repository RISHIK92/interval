# 0015. Learning goals in onboarding, ranking and Profile

- Status: ACCEPTED
- Date: 2026-10-26
- Supersedes: none
- Superseded by: none

## Context

The owner's app design (docs/wireframes/app-design.html, screen 1 "Onboarding (4 steps)", and screen 9 "Profile") adds a step that no decision covers. It asks "What should your breaks add up to?", with "We'll shape every pick around this.", and offers four options:

- Pass system design interviews ("Battles, estimation, real trade-offs")
- Get better at the stack I use ("Picks tied to your real projects")
- Finally finish that book ("Split into 4-minute sessions")
- Stay sharp, nothing formal ("A good mix, no syllabus")

Profile then shows "Your goal" with "3 of 5 core skills strong".

The docs know topics, a level and a break length, but no goal:

- §5A: "Guest-first: visitors pick topics, a level, and a break length (1–3, 3–8, or 8–15 minutes) and get a feed right away."
- PER-1: "Three layers that never overwrite each other: explicit choices (always win), inferred interests (a time-decayed embedding), and concept mastery."
- PER-3: "Cold start: onboarding choices, GitHub mapping, and an optional placement quiz."
- PER-4: "A curated table maps technologies to concepts."
- REC-1: "Candidate generators: concept gaps, embedding similarity, followed sources, projects, continue items, due reviews, topic spaces."
- REC-5: "Explanations come from the top ranking signal."
- Q-P1-13 (accepted) fixes the Phase 1 score as a weighted sum of topic match, level fit, quality, freshness and time fit, with the weights in `ranking_config`. P1-W6-S01 made them tunable.

Owner direction (2026-10-26, design pass):

- goals are adopted now, during the design pass after Phase 1;
- a user may pick several of the four;
- each goal maps to a curated concept set;
- ranking gains a goal-match signal with its own `ranking_config` weight;
- Profile shows the goals and lets the user change them;
- skill progress ("3 of 5 core skills strong") waits for Phase 2 mastery (PER-2).

Two of the four goals depend on features from later phases:

- "Finally finish that book" needs PDF books (Phase 2, Week 11);
- "Get better at the stack I use" reads naturally as GitHub mapping (PER-3, PER-4; Phase 2, Week 12).

A related owner decision, account-first onboarding (the design's "Account created" badge before this step), changes §5A's "Guest-first". It is a separate ADR, 0016.

## Decision

Accepted by the owner on 2026-10-26: option A (goals as an explicit choice that ranking scores). The open questions below still need the owner's answers before the work that depends on them.

## Options

### A. Goals as an explicit choice that ranking scores

Store the user's goals with their other explicit choices (`user_preferences`, a `goal` enum array). A curated `goal_concept` table maps each goal to concepts, in the same pattern as PER-4's curated technology table. Ranking adds `goal_match`: the share of an item's concepts in the user's goals' sets, weighted by `weight.goal_match` in `ranking_config`. Onboarding gains a goal step, and Profile edits goals the way it edits topics.

- **Pros:**
  - Matches the owner's direction.
  - Goals sit in PER-1's explicit layer, which "always wins" and is never written by inference.
  - It reuses the scoring, the weights table and the inspection page from P1-W6-S01.
  - REC-5 notes can name the goal when it is the top signal.
- **Cons:**
  - A new curated table needs owner-written concept sets.
  - Two goals have no real meaning until Phase 2 (see open questions).
  - It adds a migration, generated types, an onboarding step, a Profile field, a scoring signal, a note template and tests on both the web and the worker side.
- **Cost to reverse:** moderate. Drop the step and set the weight to 0 (instant, no deploy of logic). Removing the column and table later is a normal migration.

### B. Goals stored and shown, not scored yet

The onboarding step and Profile store and show goals; ranking ignores them until Phase 2 gives them meaning (mastery, books, GitHub).

- **Pros:**
  - Small.
  - No invented scoring.
  - Collects the data for later.
- **Cons:**
  - The design promises "We'll shape every pick around this." That would not be true in Phase 1.
  - Users choose something that visibly does nothing.
- **Cost to reverse:** low.

### C. Goals replace topic picking

Onboarding asks goals, level and break length. Topics are derived from the goals and stay editable on Profile.

- **Pros:**
  - Fewer choices up front.
  - Closest to the drawn four-step flow.
- **Cons:**
  - Contradicts §5A ("visitors pick topics").
  - Topics then come from a mapping rather than from the user, which blurs PER-1's explicit layer.
  - Every existing topic-based path (candidates, starter feeds, Profile) changes.
- **Cost to reverse:** high; the onboarding and starter-feed logic would change twice.

## Recommendation (not a decision)

**A.** The docs don't mention goals, so this rests on the owner's direction rather than on a decision ID. Given that direction, A is the option the docs support best:

- it keeps goals in PER-1's explicit layer;
- it follows PER-4's curated-mapping pattern;
- it adds a signal through the Q-P1-13 / P1-W6-S01 weight table instead of a new mechanism;
- it doesn't contradict §5A the way C does.

B would be preferable if the curated concept sets can't be written before the restyle ships.

## Consequences

- A migration adds `user_preferences.goals` (a non-empty array of a `learning_goal` enum), the `goal_concept` table and `ranking_config` `weight.goal_match`. The weight's starting value is the owner's call, tunable on /admin/ranking.
- The goal step joins onboarding, and Profile gets a Goals field.
- The worker's `score()` gains `goal_match`. Starter feeds stay topic-based unless decided otherwise.
- A note template covers "goal_match".
- An event for goal changes is likely: `onboarding_completed` props, or a new `goals_changed` (DB-5).
- `docs/product.md` §5A and the decisions are unchanged; the owner records the outcome there if accepted.
- The design-pass slices for onboarding and Profile depend on this ADR being ACCEPTED.

## Open questions

- **Concept sets:** the curated concept set for each goal. The owner writes them, or reviews an LLM draft (PER-4's pattern).
- **"Finally finish that book" before PDF books exist (Phase 2):** hidden, shown as "coming soon", or mapped to long reads (8–15 minute items)?
- **"Get better at the stack I use" before GitHub (Phase 2):** ask the user to pick technologies now, map to backend/databases concepts, or show it as coming soon?
- **"Stay sharp, nothing formal":** no boost (a general mix), or a boost to exploration (REC-4)?
- **Topics:** with several goals allowed, does onboarding still ask for topics? §5A requires it; the design's four steps don't show which steps remain.
- **Note wording** when goal_match is the top signal (REC-5), for example "Toward your goal: system design interviews".
- **Default weight** for `weight.goal_match`.
