# 0045. Weekly leagues: activity cohorts of 30 in six tiers, separate from ratings

- Status: ACCEPTED (owner, 2026-11-23)
- Date: 2026-11-23
- Supersedes: none (adds to §6.7 boards; amends ADR-0019's disabled Leagues item)
- Superseded by: none

## Context

The owner's desktop design (`docs/wireframes/web-design.html`, screen "Leagues, web", 2026-11-23; also the Play hub's league card and Profile's "Sapphire league") shows:

- "Sapphire league · 30 players at your pace · ends Sunday · 2d 6h";
- tabs League / Friends / University / All-time; a table of Rank, Player, This week ("14 matches · 1 battle", "9 matches · +41 today") and Points;
- "Promotion zone above · top 7 move up to Ruby", "Bottom 5 move down to Gold";
- tiers Diamond, Ruby, Sapphire, Gold, Silver, Bronze;
- "How leagues work: Each week you're grouped with 30 people who play about as much as you. Points come from matches, battles and reading checkpoints. A new league starts every Monday.";
- "Your university · State Tech · #3 of 212 · Verified with college email".

Nothing like it exists. Today there are boards by scope and period (§6.7: "Global, country, university (verified), and friends. Daily boards for the challenge, weekly boards for sprints, and season boards for ratings."), one quick-game rating (MATCH-2: "One shared quick-game rating at first"), Glicko-2 computed by the Python worker (ADR-0034), monthly seasons with a soft reset (Q-P3-13), and per-league battle season boards (Q-P5-20). ADR-0019 put Leagues in the web sidebar, disabled.

**Answer to Q-WD-07 (owner, 2026-11-23):** "a weekly activity cohort, separate from skill ratings. The owner asked to follow the design, so the design's stated rules hold." The rest "is the recommendation's, PROVISIONAL until the owner changes it in the ADR."

What else it touches:

- **The word "league" is taken.** §6.2 and docs/glossary.md: "**League.** Battles have two leagues from launch, human and AI, with separate ratings and leaderboards." C-29 confirmed quick games have no league switch. A weekly cohort is a second meaning.
- **ADR-0032 (ACCEPTED):** universities are "picked from a list or typed, unverified", so "Verified with college email" would be false.
- **ADR-0029 (ACCEPTED):** guests play every quick game and appear on boards, with anti-farming limits.
- **§6.9 fair play:** "Flags go to review before any penalty, and penalties affect ratings, not accounts." A penalty today removes the match's rating gain (`fair_play_flag.penalty`).
- **LOAD-5:** "every submission carries an idempotency key". **DB-5:** events. **OPS-3:** features check capabilities; ADR-0036 checks them where the feature is served.

## Options

### A. A weekly activity cohort, separate from ratings (the owner's answer)

- Points come from activity; ratings, seasons and boards are untouched. Tiers move by weekly rank in a cohort of similar activity.
- Pros: the owner's answer and the design's text; a weekly reason to come back that doesn't punish a low rating; ratings stay a clean skill measure (MATCH-2, ADR-0034).
- Cons: a second ranking system next to boards and seasons; a new scheduled job; points can be farmed by volume (caps and fair play below).
- Cost to reverse: moderate. New tables, one worker stage, one scheduled job, one page. Dropping them leaves ratings and boards as they are.

### B. A skill tier derived from the quick-game rating

- Tiers as rating bands (Bronze below 1300, …), shown on the existing boards.
- Pros: no new data; no farming.
- Cons: not what the owner chose; it ignores battles and reading; no weekly cycle, so nothing "ends Sunday".
- Cost to reverse: low.

### C. Leagues as a tab of the existing weekly boards

- The weekly sprint board renamed, with tiers as decoration.
- Pros: little to build.
- Cons: no cohorts, no promotion; boards score one game, not "matches, battles and reading checkpoints".
- Cost to reverse: low.

## Recommendation (not a decision)

**A**, the owner's answer.

**Decided by the owner (the design's stated rules):**

- a league is a weekly activity cohort, separate from skill ratings;
- a cohort is about 30 people "who play about as much as you";
- points come from matches (quick games), battles (LLD and HLD, both §6.2 leagues) and reading checkpoints (path and book checkpoints);
- a new league starts every Monday and ends Sunday;
- six tiers, top down: Diamond, Ruby, Sapphire, Gold, Silver, Bronze;
- the top 7 move up and the bottom 5 move down;
- the page's tabs are League / Friends / University / All-time.

**PROVISIONAL (the recommendation; the owner may change any of it here):**

- **Points:** a finished quick-game match 10, +5 for a win; a finished battle 30, +15 for a win; a passed reading checkpoint 10; a bot or ghost match 5 (no win bonus); an abandoned match 0. At most 300 points a day. "Match" means a 1v1 or room quick game (live, bot or ghost); solo games are an open question.
- **The week and the day:** Monday 00:00 to Sunday 23:59:59 in `BATTLE_WINDOW_TIME_ZONE` (the deployment's region, UTC when empty, Q-P5-12), which also bounds the 300-a-day cap.
- **Start:** a new player starts in Bronze, placed when they earn their first points (mid-week too, into a Bronze cohort with room), so nobody waits for Monday.
- **"At your pace":** last week's active days (days with any points, 0 to 7). On Monday each tier's players are sorted by it and cut into cohorts of 30.
- **Small tiers:** a tier with fewer than 60 players is split into near-equal cohorts of at least 20, or one cohort if fewer than 40. Movement scales with size: up = round(size × 7/30), down = round(size × 5/30), at least 1 each when the cohort has 4 or more.
- **Edges:** nobody moves down from Bronze or up from Diamond.
- **Inactive weeks:** a member with 0 points ranks at the bottom and can move down. A player with no points last week is not placed on Monday, keeps their tier, and rejoins it when they next earn points.
- **Ties:** equal points rank by who reached the total first.
- **Guests (ADR-0029):** not in leagues. Points a guest earned before sign-up are not carried over by the merge.
- **Boards:** unchanged. The Friends tab ranks this week's league points among the players the user follows; University is the existing universities board (Q-P3-13's season board, C-17); All-time links to the existing boards. Leagues replace nothing.
- **University line:** "State Tech · #3 of 212" from that board, without "Verified with college email" (ADR-0032 stands).

**Data model (high level, plain SQL migrations, ADR-0002):**

- `league_week` (the Monday it starts, the zone, closed at).
- `league_cohort` (week, tier, size).
- `league_member` (cohort, user, pace days, final rank, outcome up/stay/down), and the user's current tier on a `league_player` row.
- `league_points` ledger (user, week, source kind, source id, points, reason, at), unique on (source kind, source id, user). The source event is the idempotency key (LOAD-5): a retried match result or checkpoint can't score twice. Corrections are negative rows with their own key (`fair_play:<flag id>`), never updates.
- **Writing points:** one Python worker stage, `league-points`, enqueued with (source kind, source id) wherever the result is already recorded (the rating job of ADR-0034, the battle and HLD scoring, a checkpoint pass). It reads the source row and applies the points table and the daily cap, so the rules exist once (ARCH-2).
- **The Monday job:** `close-leagues-due` in the worker, run by EventBridge Scheduler and a VM timer (ADR-0011) after Monday 00:00. It closes the past week (ranks, outcomes, tier moves) and forms the new cohorts, idempotent per week.

**Fair play (§6.9):** flags still go to review first. A penalty on a human-league match also removes that match's points with a negative ledger row. If the week has already closed, the standing is corrected but tier moves are not redone. AI-league battles have no restrictions (§6.9), and their points count.

**Entitlements (OPS-3, ADR-0036):** a new capability `play.league`, granted to the beta plan. Points are written only for users who hold it, and the page and its API check it.

**Events (DB-5):** `league_placed` (tier, cohort size, mid-week or Monday), `league_week_closed` per member (tier, rank, points, outcome), `league_viewed` (tab). No points-per-match event; the ledger is the record.

What would change it: owner edits to any PROVISIONAL line; a beta too small for meaningful cohorts (then one cohort per tier, or Bronze only until it grows).

## Consequences

- **DB:** migrations for the four tables and the `play.league` capability, with generated TS and Python types.
- **Worker:** the `league-points` stage and `close-leagues-due`, with in-memory fakes (ADR-0012) and tests for the cap, idempotency, ties, edges, small tiers and penalties.
- **Infra:** a weekly schedule in both stacks and the VM's `interval-leagues.timer`; runbook lines.
- **Web:** the Leagues page (enabled in the sidebar, amending ADR-0019's "disabled"); the Play hub's league card and Profile's tier line read the same data. Phones reach Leagues from the Play hub card.
- **Docs:** a glossary entry for the weekly league that keeps §6.2's battle leagues distinct (see open questions); docs/conflicts.md records the "Verified" line left out.
- **Unblocks:** Q-WD-26's "Who sees your rank" setting.

## Open questions

- **Name (answered, owner 2026-11-23):** "league" is the weekly cohort everywhere. The human and AI battle leagues of §6.2 are renamed "battle mode" across the database, TypeScript, Python and Go (ADR-0047).
- Confirm or change each PROVISIONAL line above, the points table and the 300 daily cap first.
- Do solo games (the daily challenge, solo sprint and estimation, HLD solo practice of ADR-0042) earn points? Recommended: the daily challenge 5, the rest nothing, so points stay with "matches, battles and reading checkpoints".
- Should the bot and ghost matches that Q-WD-08's "vs AI" would add count at 5 points, or not at all?
- Is a rank visible to others by default, before Q-WD-26's "Who sees your rank" setting exists?
