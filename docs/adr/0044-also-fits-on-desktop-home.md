# 0044. "Also fits in N minutes" on desktop Home: up to three fixed cards under the hero

- Status: ACCEPTED (owner, 2026-11-23)
- Date: 2026-11-23
- Supersedes: none (amends ADR-0019 at `lg` and up only)
- Superseded by: none

## Context

The owner's desktop web design (`docs/wireframes/web-design.html`, screen "Home, web", 2026-11-23) puts an "Also fits in 8 minutes" grid under the hero card: "Daily challenge · 60 seconds, keeps your streak" with a Play pill, "Review 3 cards · About 2 minutes", and "Pooling, explained · Listen, 4 min".

ADR-0019 (ACCEPTED) removed exactly this, at the owner's request. Its owner answer (2026-10-26) reads:

> **Feed:** every card is full size and shows one at a time. "Also fits in …" goes away.

and its Consequences:

> Home's feed is a scroll-snapped row of full-size cards; "Also fits" and the compact row layout go away;

The reason given was "so the user actually reads the title instead of doomscrolling" (§2: "anyone replacing low-value scrolling with short, rewarding sessions").

Q-WD-01 (docs/questions/web-design.md) asked whether the web design supersedes ADR-0019 on desktop only or everywhere, and which cards qualify. **Answer (owner, 2026-11-23):** "desktop only, under a new ADR (the recommendation). Phones keep ADR-0019's sideways feed." The recommendation it accepts: "The grid would be the daily challenge (when open), due reviews (when any) and the next explainer that fits the chip."

Related: the daily challenge (§6.3, Q-P3-06, ADR-0031; capability `play.daily`, OPS-3), the review queue (PER-2, FSRS), concept explainers (§5G, ADR-0038), time chips (§3.2), Q-WD-25 (review sessions capped at 5 cards, recommended), Q-WD-27 (the hero's Listen and Something else).

## Options

### A. A fixed grid under the hero, at `lg` and up only (the owner's answer)

- At `lg` and up, the hero stays ADR-0019's sideways feed (one full-size card; "Something else" moves to the next, Q-WD-27). Under it, a grid of at most three cards, never a list of feed cards. Below `lg`, Home is unchanged.
- Pros: the owner's answer; the design as drawn; the three cards are fixed kinds, not more feed, so ADR-0019's doomscrolling concern still holds; no ranking change.
- Cons: Home differs by width; three sources of data on Home's server render instead of one.
- Cost to reverse: low. One component and three reads.

### B. The grid everywhere

- Pros: one Home for all widths.
- Cons: overrides ADR-0019 on phones, which the owner refused.
- Cost to reverse: low.

### C. No grid (ADR-0019 as it stands)

- Pros: nothing to build.
- Cons: the desktop's space under the hero stays empty; the owner asked for the grid.
- Cost to reverse: none.

## Recommendation (not a decision)

**A**, the owner's answer to Q-WD-01. ADR-0019's two quoted lines then read "… goes away below `lg`; at `lg` and up, ADR-0044's grid sits under the sideways feed."

**Which cards, in this order** (the design's order). A card appears only when all its conditions hold:

1. **Daily challenge:** today's challenge is published, the user hasn't attempted it (one attempt, §6.3), and the user holds `play.daily`. It always fits (60 seconds). Pill: Play.
2. **Review:** the user has at least one due review card. It shows "Review N cards · About M minutes", where N is the due count capped at what fits the chip at the existing estimate (`reviewMinutes`, which the rail's "cards are fading" panel already uses), and at 5 if Q-WD-25's cap is accepted; M is `reviewMinutes(N)`. Opens the review session for those N.
3. **Explainer:** the first concept tagged on the user's precomputed feed (after the hero card) that has an approved explainer with audio (ADR-0038), which the user hasn't finished, and whose `duration_seconds` is at most the chip's minutes × 60. "<Concept>, explained · Listen, N min". Opens the player.

Never shown twice: a card is left out when the hero already is that challenge or that explainer.

**When none qualify:** the heading and grid are not rendered at all, with no empty state. The chip changes only the review count and the explainer's eligibility.

What would change it: the owner asking for the grid on phones (B), or for feed cards in the grid (that would reopen ADR-0019's reasoning and needs its own answer).

## Consequences

- **Web:** an `AlsoFits` component on Home at `lg` and up; Home's server render reads today's challenge and attempt, the due count, and one explainer candidate. The phone layout and `TabBar` don't change.
- **Data:** no migration. All three reads use existing tables (daily challenge, review queue, `concept_explainer`, `explainer_audio`, explainer listens, the precomputed feed).
- **Events (DB-5):** a new `also_fits_opened` event with `kind` (`daily`, `review`, `explainer`), `position` and `chip`, so the grid's use is measurable apart from `card_opened`. `events.json` and codegen change.
- **Entitlements (OPS-3):** the challenge card checks `play.daily`; nothing new.
- **Docs:** docs/conflicts.md notes ADR-0019 as amended for wide screens once accepted.

## Open questions

- Is `reviewMinutes` the right input for "About M minutes", or should it come from the user's own recent review times?
- Should the explainer card prefer the hero card's own concept ("Listen" on the hero already covers it, Q-WD-27), or always a different concept as recommended?
- Does a tap on the challenge card start the challenge in place (the Play pill) or open its page?
