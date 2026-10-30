# Phase 3 questions

Gaps, ambiguities and underspecified points that block or risk Phase 3 (docs/roadmap/phase-3.md, slices in docs/roadmap/phase-3-slices.md). Each has a suggested default that applies only if the owner accepts it. None of the defaults are decisions.

Priority: **P0** blocks the week's first slice; **P1** blocks a later slice; **P2** a risk, not a blocker.

## Across the phase

### Q-P3-01 The game server's shape in both modes (P0 for Week 15)

- Cite: ARCH-1 (deployables added in the phase that needs them), ARCH-2 (Go: game server), LOAD-2 (match actors behind an ALB with WebSockets), ADR-0011 (two modes from the same code), ADR-0013.
- Why it matters: it's the first Go code and a new deployable. With several game servers, a player's socket must reach the server that owns their match.
- **Answer (owner, 2026-10-31):** the suggested default: a signed match ticket names the owning server; one game server behind Caddy in VM mode; Go never reads the auth database. Written up as an ADR before W15-S01.
- Suggested default: an ADR before W15-S01. One Go service in `services/game`. The match ticket names the owning server; in AWS the ALB routes by a path or header the ticket carries; in VM mode one game server behind Caddy. The web app signs tickets with a shared secret (W15-S02); Go never touches the auth database.

### Q-P3-02 Which worker computes ratings (P0 for Week 16)

- Cite: MATCH-1 ("calculated after the match by a TypeScript worker, not the Go server"), ADR-0008 (the Python worker owns ranking and AI jobs), ARCH-2 ("Nothing implemented twice"), roadmap Week 16 ("calculated by the worker").
- Why it matters: there is no TypeScript worker today. MATCH-1 says TypeScript; every existing worker job is Python.
- Options: (a) a small TypeScript worker, a new deployable, as MATCH-1 says; (b) the Python worker, which needs an ADR amending MATCH-1.
- **Answer (owner, 2026-10-31):** (b), the Python worker. Needs an ADR amending MATCH-1 before W16-S01.
- Suggested default: (b). One worker to run and deploy; Glicko-2 is about 150 lines with no model calls. If the owner prefers MATCH-1 as written, (a).

### Q-P3-03 Guests and Play (P1)

- Cite: ADR-0016 (account-first onboarding), guest sessions (Phase 1).
- Why it matters: guests can read; can they play, appear on boards, open a challenge link?
- **Answer (owner, 2026-10-31):** guests are revived for Play and can do everything, boards and live games included; on sign-up the guest's games, ratings and streak merge into the account. Reverses part of ADR-0016 (account first), so it needs an ADR before W13-S01, with limits against throwaway-guest farming of boards and ratings (open: which limits).
- Suggested default: guests can play solo games and the daily challenge but are not on boards; live games and challenges ask them to create an account.

## Week 13

### Q-P3-04 Which concepts a solo sprint draws from (P0)

- Cite: §6.3, MATCH-4 (for two players), PER-1.
- **Answer (owner, 2026-10-31):** the suggested default: explored-or-better concepts first, then the goals' concepts; difficulty near the player's level; no repeat within 7 days.
- Suggested default: the player's explored or better concepts first, then concepts of their goals; difficulty near their estimated ability (Q-3's values); no question repeated within 7 days.

### Q-P3-05 Where estimation questions come from (P0 for S03)

- Cite: §6.3 ("back-of-envelope estimation"), §6.8, Q-1, AI-3 (AI output cites its source passages).
- Why it matters: the generator writes multiple-choice questions from a moment's text. Estimation answers (e.g. "requests per second a single Postgres box handles") are often not in any moment, so a citation may not exist.
- Options: (a) the generator also writes numeric questions, only where the moment states the number (cited, validated like Q-1); (b) hand-written (§6.8 allows it for the daily challenge and seasons); (c) both.
- **Answer (owner, 2026-10-31):** (c), both: cited generator questions where the article states the number, plus a hand-written set entered in admin.
- Suggested default: (c): cited generator questions where a number is in the text, plus a hand-written set the owner enters in admin.

### Q-P3-06 The daily challenge's day, size and review fallback (P0 for S05)

- Cite: Q-2 ("The daily challenge is reviewed the day before"), LOAD-4.
- **Answer (owner, 2026-10-31):** UTC day, 5 questions; an unreviewed set auto-publishes (its questions already passed the validator). This changes Q-2 ("reviewed the day before"), so it needs an ADR amending Q-2 before W13-S05.
- Suggested defaults: the day is UTC; 5 questions, a mix of multiple choice and estimation; the job picks tomorrow's set at 00:00 UTC for review; if the owner hasn't reviewed it by the next 00:00, yesterday's validated-and-spot-checked questions are used instead (never an unreviewed set), and the gap is logged.

### Q-P3-07 Streaks (P1)

- Cite: §6.3 ("Score and streak"), §8 ("daily challenge streaks").
- **Answer (owner, 2026-10-31):** with freezes: consecutive UTC days with a finished challenge; a freeze is earned every 7 days played and covers one missed day (open: how many can be held).
- Suggested default: consecutive UTC days with a finished challenge; a missed day resets it; no freezes.

## Week 14

### Q-P3-08 Where a player's country comes from (P1)

- **Answer (owner, 2026-10-31):** the suggested default: chosen on Profile, optional, changeable once a month; no IP lookup.
- Suggested default: chosen on Profile (optional, changeable once a month); no IP geolocation.

### Q-P3-09 University domain list and email storage (P0 for S03)

- Cite: OPS-1, Phase 3 Week 14 ("SES verification with a domain list and a manual review queue").
- Why it matters: a list needs a source and a licence; storing university emails is personal data.
- **Answer (owner, 2026-10-31):** the player picks their university from a list (a public list or API, licence checked; Hipo's university-domains-list is a candidate), or types a name if it's missing; admin unifies custom names later. Picking alone counts for the board, with no email verification. §6.7 ("university (verified)") and Week 14 ("SES verification…") say otherwise, so this needs an ADR. No university email is stored.
- Suggested default: a list kept in the repo (seeded from a public domain list, licence checked before use, or hand-built); keep only the domain and the verified university, not the full address.

### Q-P3-10 University boards before ratings (P2)

- Cite: ADR-0006 C-17 (average rating of verified members).
- **Answer (owner, 2026-10-31):** average of members' challenge scores until ratings exist, then average rating; no minimum number of members.
- Suggested default: until Week 16, the average of members' challenge scores; afterwards the average rating; a university needs at least 3 verified members to be ranked.

### Q-P3-11 What a friend is (P1)

- **Answer (owner, 2026-10-31):** one-way follow by username, no accept step. Needs public usernames and a people search, which don't exist yet (open: username rules, and whether a player can hide from search).
- Suggested default: mutual; added by an invite link; no search for people; friends see each other's board rank only.

## Week 15

### Q-P3-12 Abandon penalties (P1)

- Cite: MATCH-6 ("abandon penalties").
- **Answer (owner, 2026-10-31):** the suggested default: an abandon counts as a loss; nothing else.
- Suggested default: an abandoned match counts as a loss in the rating; nothing else.

## Week 16

### Q-P3-13 Seasons and soft resets for quick games (P2)

- Cite: §6.6 ("with seasons and soft resets"), §6.7 ("season boards for ratings").
- **Answer (owner, 2026-10-31):** monthly seasons for quick games, with season boards and a soft reset toward the mean (open: how strong the reset is).
- Suggested default: no seasons in Phase 3; boards show all-time rating. Seasons arrive with battles.

### Q-P3-14 Regions (P2)

- Cite: MATCH-3 ("grouped by region").
- **Answer (owner, 2026-10-31):** the suggested default: one region; queue keys carry it.
- Suggested default: one region until there's more than one deployment region; the queue keys carry the region so adding one changes no code.

### Q-P3-15 Two players with no shared concepts (P1)

- Cite: MATCH-4.
- **Answer (owner, 2026-10-31):** the suggested default: either player's goal concepts, then the general pool, at the average rating's difficulty.
- Suggested default: concepts of either player's goals, then the general pool, at the average rating's difficulty.

## Week 17

### Q-P3-16 What a friend challenge link plays (P1)

- **Answer (owner, 2026-10-31):** live only: the link opens a private live match; both players must be online.
- Suggested default: the recipient plays the same questions against the sender's ghost (BOT-1); half-weight rating (BOT-4); live play only if both are online.

### Q-P3-17 The agent hook CLI's language, distribution and auth (P0 for S04)

- Cite: §7, ARCH-2 (lists Go for the game server and execution engine only), glossary "Agent hook".
- **Answer (owner, 2026-10-31):** a Go binary. ARCH-2 lists Go for the game server and execution engine only, so the CLI's language goes in an ADR (it can share the game server's toolchain and CI). Distribution and auth still open: suggested a device token made on Profile, binaries on GitHub releases; ask before publishing.
- Suggested default: TypeScript, published on npm as a single bin (`npx interval-hook`) — no new language, no new runtime for most developers. A device token made on Profile, revocable. Ask before publishing anything: npm publishing is outward-facing.

### Q-P3-18 How the 45-second notification reaches the user (P0 for S05)

- Cite: §7 ("a notification offers a quick session"), §5K (notifications).
- Why it matters: no push notifications exist yet.
- Options: (a) the CLI shows a terminal or OS notification itself; (b) web push to the PWA (a new notification channel and permission prompt); (c) both.
- **Answer (owner, 2026-10-31):** (c), both: the CLI's own notification, and web push to the PWA. Web push likely needs a new dependency (asked before adding).
- Suggested default: (a) first: no new server-side channel; the link opens Interval at a session that fits.

## Week 18

### Q-P3-19 k6 (P1)

- Cite: Phase 3 Week 18 ("WebSocket load testing with k6").
- Why it matters: k6 is a new tool (a binary via brew), not an npm dependency.
- **Answer (owner, 2026-10-31):** the suggested default: k6 via brew, run locally, not in CI.
- Suggested default: install with brew locally; not in CI.

### Q-P3-20 Fair-play thresholds for quick games (P1)

- Cite: §6.9, ADR-0006 C-14.
- **Answer (owner, 2026-10-31):** the suggested default: answers under 400 ms (compensated) and focus changes in a live round are signals; 3 in a match raise a flag for review.
- Suggested default: an answer faster than 400 ms after the question arrives (compensated), or a focus change during a live round, is a signal; three signals in a match raise a flag for review.
