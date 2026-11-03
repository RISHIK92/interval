# Phase 3 questions

Gaps, ambiguities and underspecified points that block or risk Phase 3 (docs/roadmap/phase-3.md, slices in docs/roadmap/phase-3-slices.md). Each has a suggested default that applies only if the owner accepts it. None of the defaults are decisions.

Priority: **P0** blocks the week's first slice; **P1** blocks a later slice; **P2** a risk, not a blocker.

## Across the phase

### Q-P3-01 The game server's shape in both modes (P0 for Week 15)

- Cite: ARCH-1 (deployables added in the phase that needs them), ARCH-2 (Go: game server), LOAD-2 (match actors behind an ALB with WebSockets), ADR-0011 (two modes from the same code), ADR-0013.
- Why it matters: it's the first Go code and a new deployable. With several game servers, a player's socket must reach the server that owns their match.
- **Answer (owner, 2026-10-31):** the suggested default: a signed match ticket names the owning server; one game server behind Caddy in VM mode; Go never reads the auth database. Written up as an ADR before W15-S01.
- **Follow-up (owner, 2026-11-02):** ADR-0033 ACCEPTED. For W15-S02, before matchmaking exists: a small match record (`game_match` and `game_match_player`). The web app issues a ticket only for a match the player is in, and a dev-only script creates a test match; W16 matchmaking writes the same rows. Accounts and guests both join live matches (ADR-0029).
- Suggested default: an ADR before W15-S01. One Go service in `services/game`. The match ticket names the owning server; in AWS the ALB routes by a path or header the ticket carries; in VM mode one game server behind Caddy. The web app signs tickets with a shared secret (W15-S02); Go never touches the auth database.

### Q-P3-02 Which worker computes ratings (P0 for Week 16)

- Cite: MATCH-1 ("calculated after the match by a TypeScript worker, not the Go server"), ADR-0008 (the Python worker owns ranking and AI jobs), ARCH-2 ("Nothing implemented twice"), roadmap Week 16 ("calculated by the worker").
- Why it matters: there is no TypeScript worker today. MATCH-1 says TypeScript; every existing worker job is Python.
- Options: (a) a small TypeScript worker, a new deployable, as MATCH-1 says; (b) the Python worker, which needs an ADR amending MATCH-1.
- **Answer (owner, 2026-10-31):** (b), the Python worker. Needs an ADR amending MATCH-1 before W16-S01.
- **Follow-up (owner, 2026-11-02):** ADR-0034 ACCEPTED. Glicko-2 starts at 1500/350/0.06 (τ 0.5) and updates per match. Guests are rated, and on sign-up the account keeps the more-played rating. An abandon is a loss for the leaver and a win for the stayer; both abandoned is a loss each; cancelled and void are unrated.
- Suggested default: (b). One worker to run and deploy; Glicko-2 is about 150 lines with no model calls. If the owner prefers MATCH-1 as written, (a).

### Q-P3-03 Guests and Play (P1)

- Cite: ADR-0016 (account-first onboarding), guest sessions (Phase 1).
- Why it matters: guests can read; can they play, appear on boards, open a challenge link?
- **Answer (owner, 2026-10-31):** guests are revived for Play and can do everything, boards and live games included; on sign-up the guest's games, ratings and streak merge into the account. Reverses part of ADR-0016 (account first), so it needs an ADR before W13-S01, with limits against throwaway-guest farming of boards and ratings (open: which limits).
- **ADR-0029 open questions, answered (owner, 2026-10-31):**
  - Invite: the landing page's Play entry asks for an invite code; a challenge link counts as the sender's invite (same group, no code use spent).
  - Merge conflicts: keep the higher streak; keep the account's rating, the guest's results added as history; each board keeps the better score.
  - Follows: a guest can't follow or be followed until sign-up.
- Suggested default: guests can play solo games and the daily challenge but are not on boards; live games and challenges ask them to create an account.

## Week 13

### Q-P3-04 Which concepts a solo sprint draws from (P0)

- Cite: §6.3, MATCH-4 (for two players), PER-1.
- **Answer (owner, 2026-10-31):** the suggested default: explored-or-better concepts first, then the goals' concepts; difficulty near the player's level; no repeat within 7 days.
- **Added (owner, 2026-10-31, P3-W13-S02):** when neither tier has a question (a guest, a new account), the whole bank, at the player's level, as for two players (Q-P3-15).
- Suggested default: the player's explored or better concepts first, then concepts of their goals; difficulty near their estimated ability (Q-3's values); no question repeated within 7 days.

### Q-P3-05 Where estimation questions come from (P0 for S03)

- Cite: §6.3 ("back-of-envelope estimation"), §6.8, Q-1, AI-3 (AI output cites its source passages).
- Why it matters: the generator writes multiple-choice questions from a moment's text. Estimation answers (e.g. "requests per second a single Postgres box handles") are often not in any moment, so a citation may not exist.
- Options: (a) the generator also writes numeric questions, only where the moment states the number (cited, validated like Q-1); (b) hand-written (§6.8 allows it for the daily challenge and seasons); (c) both.
- **Answer (owner, 2026-10-31):** (c), both: cited generator questions where the article states the number, plus a hand-written set entered in admin.
- **Addendum (owner, 2026-10-31, P3-W13-S03):** a hand-written question carries its source page's URL and title and the quoted sentence stating the number; it goes live at once (still in the weekly sample, flaggable, retirable). The generated half moved to P3-W13-S03b.
- **Addendum (owner, 2026-10-31, P3-W13-S04, the solo round):**
  - a 60-second clock, as many as fit, like the sprint (the reveal after each answer runs on the clock; the results repeat every answer and source);
  - an answer under half points (about 3.5× off) sends its source back to reading;
  - a game score only: never mastery, review (FSRS) or difficulty evidence;
  - questions picked by Q-P3-04's rule, as for the sprint.
- Suggested default: (c): cited generator questions where a number is in the text, plus a hand-written set the owner enters in admin.

### Q-P3-06 The daily challenge's day, size and review fallback (P0 for S05)

- Cite: Q-2 ("The daily challenge is reviewed the day before"), LOAD-4.
- **Answer (owner, 2026-10-31):** UTC day, 5 questions; an unreviewed set auto-publishes (its questions already passed the validator). This changes Q-2 ("reviewed the day before"), so it needs an ADR amending Q-2 before W13-S05.
- Suggested defaults: the day is UTC; 5 questions, a mix of multiple choice and estimation; the job picks tomorrow's set at 00:00 UTC for review; if the owner hasn't reviewed it by the next 00:00, yesterday's validated-and-spot-checked questions are used instead (never an unreviewed set), and the gap is logged.

### Q-P3-07 Streaks (P1)

- Cite: §6.3 ("Score and streak"), §8 ("daily challenge streaks").
- **Answer (owner, 2026-10-31):** with freezes: consecutive UTC days with a finished challenge; a freeze is earned every 7 days played and covers one missed day (open: how many can be held).
- **Answer (owner, 2026-11-01):** a player holds at most 1 freeze.
- Suggested default: consecutive UTC days with a finished challenge; a missed day resets it; no freezes.

## Week 14

### Q-P3-08 Where a player's country comes from (P1)

- **Answer (owner, 2026-10-31):** the suggested default: chosen on Profile, optional, changeable once a month; no IP lookup.
- Suggested default: chosen on Profile (optional, changeable once a month); no IP geolocation.

### Q-P3-09 University domain list and email storage (P0 for S03)

- Cite: OPS-1, Phase 3 Week 14 ("SES verification with a domain list and a manual review queue").
- Why it matters: a list needs a source and a licence; storing university emails is personal data.
- **Answer (owner, 2026-10-31):** the player picks their university from a list (a public list or API, licence checked; Hipo's university-domains-list is a candidate), or types a name if it's missing; admin unifies custom names later. Picking alone counts for the board, with no email verification. §6.7 ("university (verified)") and Week 14 ("SES verification…") say otherwise, so this needs an ADR. No university email is stored.
- **Follow-up (owner, 2026-11-02):** ADR-0032 ACCEPTED (option A). Changing a university: once in 30 days, removable any time (the country rule); a typed name shows on boards at once and the owner merges, renames or removes it at `/admin/universities`; a university change, and a country change, are DB-5 events.
- Suggested default: a list kept in the repo (seeded from a public domain list, licence checked before use, or hand-built); keep only the domain and the verified university, not the full address.

### Q-P3-10 University boards before ratings (P2)

- Cite: ADR-0006 C-17 (average rating of verified members).
- **Answer (owner, 2026-10-31):** average of members' challenge scores until ratings exist, then average rating; no minimum number of members.
- **Follow-up (owner, 2026-11-02):** every board ranks universities (daily, weekly sprint, weekly estimation), each by the average over the members with a score on that board (who played that day or week).
- Suggested default: until Week 16, the average of members' challenge scores; afterwards the average rating; a university needs at least 3 verified members to be ranked.

### Q-P3-11 What a friend is (P1)

- **Answer (owner, 2026-10-31):** one-way follow by username, no accept step. Needs public usernames and a people search, which don't exist yet (open: username rules, and whether a player can hide from search).
- **Follow-up (owner, 2026-11-02):** usernames are unique, 3–20 characters of a–z, 0–9 and underscore, chosen on Profile; players appear in people search unless they turn it off (following by exact username still works).
- **Follow-up 2 (owner, 2026-11-02):** a username is required for every account (asked once); it can never be changed; a player sees the full list of who follows them.
- **Follow-up 3 (owner, 2026-11-02):** new accounts pick the username in onboarding; an existing account is sent once to a page that asks for it on its next visit to the feed, Profile or Play. Following and unfollowing are DB-5 events. Boards show the username only, never the account's name. (Built as: the username is asked straight after onboarding, at the first gated page, the feed.)
- **P3-W14-S06 (owner, 2026-11-02):** boards live on their own page, `/play/boards`. A guest shows as "Guest" plus 4 digits from a hash of its id. Each board shows the top 50 of the current period, with the player's own row always visible. Only the current and previous period can be viewed.
- **Follow-up 4 (owner, 2026-11-02):** a short list of usernames is reserved, so nobody can pose as the site: admin, administrator, interval, support, moderator, mod, system, staff, help, root, owner, official, guest, player.
- Suggested default: mutual; added by an invite link; no search for people; friends see each other's board rank only.

## Week 15


### Q-P3-21 A guest who signs up during a live match (P1, before W15-S03)

- Cite: ADR-0029 (guests play live; merged on sign-up), ADR-0033 (tickets carry the user id), MATCH-6 (a 10-second reconnect grace period).
- Why it matters: since P3-W15-S02, merging a guest moves its match rows to the account. But the open socket and any ticket already issued carry the guest's id. Once the match actor tracks players by that id (S03), a player who signs up mid-match would come back as someone else, and if the account was in the same match, the two become one player.
- **Answer (owner, 2026-11-02):** the suggested default. The match plays on under the guest's id, the result is written to the account when it finishes, and a reconnect after sign-up is the same player.
- Suggested default: signing up mid-match is allowed. The match plays on under the guest's id, and its result is written to the account when it finishes (S05 maps the guest's id to the account). A reconnect after sign-up gets a ticket for the account, which the actor treats as the same player.

### Q-P3-22 What a live 1v1 match plays (P0 for W15-S03)

- Cite: §6.6 (live games), LOAD-2 (match actor), MATCH-4 (questions from shared concepts), MATCH-5 (server-side timing).
- **Answer (owner, 2026-11-02):**
  - 7 rounds of 15 seconds, the same question to both players;
  - a right answer scores 100 plus up to 50 for speed, on the server's clock (MATCH-5);
  - the highest total wins, and a tie goes to the lower total answer time;
  - questions: the web app picks them when the match is made (multiple choice from the live bank) and hands the set to the owning game server through Valkey. Go never reads Postgres, and the client never gets the keys.

### Q-P3-12 Abandon penalties (P1)

- Cite: MATCH-6 ("abandon penalties").
- **Answer (owner, 2026-10-31):** the suggested default: an abandon counts as a loss; nothing else.
- Suggested default: an abandoned match counts as a loss in the rating; nothing else.
- **Follow-up (owner, 2026-11-02, W15-S04):**
  - a player who doesn't reconnect within the 10 s grace (MATCH-6) abandons. The match ends at once, the other player wins, and the abandon is a loss;
  - if both are gone past their graces, there's no winner and each has an abandon (a loss);
  - after a game-server restart, the interrupted round is played again from its start with the same question, and earlier answers in it are discarded. Players get 60 s to come back: whoever isn't back abandons, and with nobody back the match is void;
  - a guest who signs up into the account that is its own opponent plays on, as an ordinary match.

## Week 16

### Q-P3-13 Seasons and soft resets for quick games (P2)

- Cite: §6.6 ("with seasons and soft resets"), §6.7 ("season boards for ratings").
- **Answer (owner, 2026-10-31):** monthly seasons for quick games, with season boards and a soft reset toward the mean (open: how strong the reset is).
- **Follow-up (owner, 2026-11-03, W16-S06):**
  - a season ends on the 1st (UTC). Each rating moves to 1500 + 0.75 × (rating − 1500), its RD is raised to at least 150, and volatility stays;
  - the season board lists anyone with at least one rated live match in the season, ranked by current rating;
  - its scopes match the other boards': global, country, university and friends; top 50 with your own row; the current season and the one before;
  - on the season board, universities rank by their members' average rating there (C-17). The daily and weekly boards keep their own scores.
- Suggested default: no seasons in Phase 3; boards show all-time rating. Seasons arrive with battles.

### Q-P3-14 Regions (P2)

- Cite: MATCH-3 ("grouped by region").
- **Answer (owner, 2026-10-31):** the suggested default: one region; queue keys carry it.
- **Follow-up (owner, 2026-11-03, W16-S02):** the rating band starts at ±100 and widens by 100 every 2 s (±600 by the 10 s fallback, W17-S02). Accounts and guests both queue. A DB-5 event `match_found {wait_ms}` records time to match.
- Suggested default: one region until there's more than one deployment region; the queue keys carry the region so adding one changes no code.

### Q-P3-15 Two players with no shared concepts (P1)

- Cite: MATCH-4.
- **Answer (owner, 2026-10-31):** the suggested default: either player's goal concepts, then the general pool, at the average rating's difficulty.
- **Follow-up (owner, 2026-11-03, W16-S03):** a player's concepts are those with mastery evidence (a concept_mastery row, guests included). The pair's average rating sets the level: under 1400 beginner, 1400–1700 intermediate, over 1700 advanced. When a level is thin, the nearest level fills the set. (Built as: "goal concepts" are `user_goal_concepts`, as for the solo sprint; retired concepts never count; a question with no difficulty counts as one level off.)
- Suggested default: concepts of either player's goals, then the general pool, at the average rating's difficulty.

## Week 17

### Q-P3-23 What a live 1v1 sprint plays (P0 for W16-S04)

- Cite: §6.3 ("60-second sprint: solo or 1v1, most correct in 60 seconds"), Q-P3-22, MATCH-2, MATCH-4, MATCH-5.
- **Answer (owner, 2026-11-03):**
  - both players get the same ordered list of 30 questions (S03's rule) and answer at their own pace for 60 s on the server's clock. Each sees the other's correct count live;
  - most correct wins; a tie goes to whoever reached that total first, otherwise it's a draw. A player who finishes all 30 waits for the clock;
  - each answer shows right or wrong only. The right options appear on the results screen, so the key never reaches the client mid-match;
  - Q-P3-22's 7-rounds mode becomes fastest finger in W16-S05. Each mode has its own matchmaking queue, and both feed the one quick-game rating (MATCH-2).
  - a 3 s countdown on the server's clock once both are connected;
  - a live sprint feeds the rating only. The weekly sprint board stays solo, and the rating board comes with seasons (W16-S06);
  - the results screen shows won, lost or draw, both correct counts, and each question with the player's answer and the right one. The new rating shows on Play once the worker has rated; nothing waits on it.

### Q-P3-24 What fastest finger plays (P0 for W16-S05)

- Cite: §6.3 ("Fastest finger: 1v1 live, 7 rounds; first correct answer takes each round"), Q-P3-22, Q-P3-23, MATCH-5.
- **Answer (owner, 2026-11-03):**
  - Q-P3-22's 7 rounds of 15 s and the same question to both. Each player gets one answer per round. The first right answer takes the round and ends it at once. A wrong answer locks that player out, and the other can still take it. Both wrong, or 15 s pass, and nobody takes it. The right answer then shows for 3 s;
  - most rounds taken wins. A tie goes to the lower total time over the rounds each player took (on the server's clock, compensated); equal is a draw;
  - a player waits in one mode's queue at a time: joining one leaves the other;
  - (the sprint, Q-P3-23) when both players have answered all 30, the sprint ends at once.

### Q-P3-25 Ghosts (P0 for W17-S01)

- Cite: BOT-1 (ghosts first: replays of real recorded runs), BOT-3 (always labeled), BOT-4 (half-weight ratings).
- **Answer (owner, 2026-11-03):**
  - each player's side of a finished live match (sprint or fastest finger) is recorded: question ids, choices, and answer times on the server's clock. Solo runs don't qualify;
  - a player meets a run of the same mode from the last 30 days, by someone else, whose rating then was closest to the player's now. It's never one the player has met before (falling back to the oldest met);
  - labeled "Ghost" with the run's rating band (e.g. "Ghost · ~1600"), never the original player's name;
  - in S01, a "Play a ghost now" button on the live queue screen leaves the queue and starts a ghost match; S02 adds the automatic switch after 10 s.

### Q-P3-26 Synthetic bots and the 10 s fallback (P0 for W17-S02)

- Cite: BOT-2 (built from question difficulty and real players' answer times), BOT-3, BOT-4, ADR-0006 C-01 (10 s; countdown and "Play bot now" from screen 11).
- **Answer (owner, 2026-11-03):**
  - a bot answers each question right with that question's real correct rate over all recorded answers. With too few answers: 80% beginner, 65% intermediate, 50% advanced. A wrong answer picks a wrong option at random;
  - its time on each question is drawn from real live answer times on that question. With too few, from all of the mode's live answer times; with none yet, 3–9 s;
  - it is rated as an opponent at the player's own rating (RD 350), at half weight (BOT-4), and labeled "Bot · ~1600";
  - one "Play bot now" button replaces "Play a ghost now". It and the automatic switch after 10 s (with a countdown) both give a ghost if one fits, else a bot.
  - (follow-up) a question with no difficulty level counts as intermediate (65%).

### Q-P3-16 What a friend challenge link plays (P1)

- **Answer (owner, 2026-10-31):** live only: the link opens a private live match; both players must be online.
- **Follow-up (owner, 2026-11-03, W17-S03):**
  - a link works for 10 minutes and for the first person who opens it (not the sender); then it says it expired or was taken;
  - "online" means the sender used the app in the last 2 minutes. Opening the link notifies the sender's open tab, and the friend waits up to 60 s for them;
  - a friend challenge is unrated (no rating or season board change); its answers still count as mastery evidence and review.
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
