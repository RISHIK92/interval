# 0019. Web Home layout: sidebar with Leagues, a sideways feed, a "Coming later" column and a greeting

- Status: ACCEPTED
- Date: 2026-10-26
- Supersedes: none (amends ADR-0017)
- Superseded by: none

## Context

The owner's new design (design file "Interval app design (8)", screen "Web · Home", shared 2026-10-26) lays out the web app differently from today's phone-first Home:

- a left sidebar with Home, Explore, Paths, Play, **Leagues** and Library, and the profile at the bottom;
- a greeting header with the break-length chips;
- one large card with a picture of its topic;
- a right-hand column: streak, your path, cards fading, tonight's battle.

The owner asked for this layout with one change: the feed moves **sideways**, on web and phone, one full-size card at a time. The only hint that more cards exist is a very faint edge of the next one. There are no dots, arrows or words, "so the user actually reads the title instead of doomscrolling". product.md §2 names the audience as "anyone replacing low-value scrolling with short, rewarding sessions".

Owner answers, 2026-10-26:

- **Feed:** every card is full size and shows one at a time. "Also fits in …" goes away.
- **Right column:** the design's panels are shown greyed out as "Coming later". None of them exists in Phase 1.
- **Leagues:** in the sidebar, disabled, web only.
- **Greeting:** short, "nerdy and meme-y" lines chosen by time of day and the context Interval has. The pool grows as context grows (streaks, GitHub, …).

**What this touches:**

- **ADR-0017 (ACCEPTED):** "five tabs, three shown disabled": Home, Explore, Paths, Play, Library. Leagues makes six items on the web sidebar. That changes ADR-0017, which needs its own record.
- **product.md §6.2 Leagues:** leagues are part of Play ("Play | Quick games, battles, leagues, leaderboards, tournaments", §3). A separate Leagues item puts them in navigation ahead of their phase, disabled.
- **The design's Home** draws the hero plus "Also fits in N minutes" as a vertical list. The sideways feed departs from it at the owner's request. Wireframes rank last in precedence, so this records the owner's choice.

## Decision

Accepted by the owner on 2026-10-26: option A.

## Options

### A. Adopt the layout as the owner described it

- **Web at `lg` and up:** the sidebar, with Leagues disabled. **Phones:** the five-tab bar from ADR-0017, without Leagues.
- **Feed:** one full-size card at a time, scroll-snapped sideways, with a faint edge of the next card.
- **Right column (web):** four greyed "Coming later" panels, without made-up numbers.
- **Greeting:** chosen on the device from the hour, the weekday, the first name, the chip and the first Continue card, steady for each part of the day.
- **Pros:**
  - It is what the owner asked for.
  - Leagues and the column are disabled placeholders, like Explore, Paths and Play.
  - It is presentation only: no ranking or data rules change.
- **Cons:**
  - Fewer cards are visible at once.
  - Sideways scroll is less discoverable with a desktop mouse wheel (trackpad, shift+wheel and arrow keys work).
  - Four disabled panels promise features that are phases away.
- **Cost to reverse:** low. Layout and copy only.

### B. Adopt the layout without Leagues

The same as A, keeping ADR-0017's five items.

- **Pros:**
  - No change to ADR-0017.
- **Cons:**
  - Not what the owner asked.
- **Cost to reverse:** low.

## Recommendation (not a decision)

**A.** It is the owner's stated choice and changes presentation only. Leagues, like the other later tabs, is disabled and does nothing until its phase (§6.2). The finished-rate metric (Q-P1-21, P1-W6-S04) will show whether one card at a time helps people finish.

## Consequences

- **Web:**
  - `TabBar` is a bottom bar below `lg` and a sidebar at `lg` and up, with Leagues disabled there only;
  - Home's feed is a scroll-snapped row of full-size cards; "Also fits" and the compact row layout go away;
  - a `ComingLater` column appears at `lg`;
  - a client `Greeting` with a line pool in `greetings.ts`.
- **Data:**
  - feed cards carry their source's first known topic, for the card's picture (`TopicArt`), through a view migration;
  - the preferences read carries the account's first name (none for a guest), for the greeting.
- **Events:** no change. `feed_viewed` still counts the cards loaded; `card_opened` keeps its position (the card's index in the row).

## Open questions

- Should a sideways swipe past a card count as "skipped" for ranking later? Not now: no event is proposed.
