# Web design questions

The owner's desktop web designs (`docs/wireframes/web-design.html`, 2026-11-23) were applied as a restyle: every built screen now follows them on wide screens, and phones keep the mobile design. The owner chose to build the features the designs show that don't exist yet. Each needs product answers first (CLAUDE.md: never invent product behaviour), so they are asked here, grouped by feature. The recommendations are Claude's, not decisions. Nothing below is built until it is answered.

Conflicts with earlier decisions come first: they need a ruling, and some need an ADR.

## Conflicts with accepted decisions

### Q-WD-01 "Also fits in N minutes" on Home (P0)

- **Design:** Home, web. Under the hero card, "Also fits in 8 minutes" shows a grid: Daily challenge with a Play pill, "Review 3 cards · About 2 minutes", and "Pooling, explained · Listen, 4 min".
- **Conflict:** ADR-0019 (ACCEPTED) replaced this with the sideways one-card feed, at the owner's request.
- **Question:** does the web design supersede ADR-0019 on desktop only, or everywhere? Which cards qualify as "fits": the chip's own feed, the daily challenge, due reviews, explainers?
- **Recommendation:** desktop only, as a new ADR. The grid would be the daily challenge (when open), due reviews (when any) and the next explainer that fits the chip. The sideways feed stays on phones.

- **Answer (owner, 2026-11-23):** desktop only, under a new ADR (the recommendation). Phones keep ADR-0019's sideways feed.

### Q-WD-02 Chapter locks in books (P0)

- **Design:** Paths, web. Later chapters show padlocks, with "2 sessions and a checkpoint until Partitioning unlocks" and "Pass it and Partitioning opens".
- **Conflict:** Q-P2-35 (updated 2026-10-29) says a book's chapters don't lock.
- **Recommendation:** keep chapters open. Show the checkpoint as the suggested next step, without a padlock. If the owner wants locks back, the rule changes in docs/questions/phase-2.md, and docs/conflicts.md records it.

### Q-WD-03 Explore's popularity list (P1)

- **Design:** Explore, web. "Saved most this week" with tabs Engineers / Spaces / New.
- **Conflict:** §5C ranks "not by popularity" (C-28).
- **Recommendation:** Explore may show popularity, because it's a browse page and not the feed. Rules:
  - an item appears only once at least 5 distinct users saved it;
  - items the user already read or hid are left out;
  - the label says "Saved most this week", so it's never presented as a recommendation.

### Q-WD-04 Profile's privacy note (P1)

- **Design:** Profile, web. "…you can export or delete everything from here at any time".
- **Conflict:** neither export nor account deletion exists, so the note would be false. It was left out.
- **Recommendation:** build both:
  - **Export:** a JSON archive of the user's own choices, saves, notes, history, answers and ratings.
  - **Delete:** account deletion with a confirm step and a 7-day grace period.

  The note then goes in.

### Q-WD-05 Desktop companion "9 of 9 tests pass" (P0 for Phase 7 W48)

- **Design:** Desktop companion. "✓ Your agent finished, 9 of 9 tests pass".
- **Conflict:** §7. The hook sends only started and finished, never anything about the task.
- **Recommendation:** never build this. The finished card says "Your agent finished". Also "Quiet while you type": typing detection risks seeing code, so the companion stays quiet based on the agent hook's state only.

## Streaks and leagues

### Q-WD-06 Streak shields and the week dots (P0)

- **Design:**
  - Home rail: "5-day streak · 1 shield", M–S dots, "Any session today keeps it going".
  - Play hub: "Shield ready for the weekend".
  - Profile: "This week" bars, "Saturday was covered by your shield".
- **Today:** the daily-challenge streak with freezes (Q-P3-07). "Freeze held" means one was used; nobody holds shields. There is no per-day activity history.
- **Questions:**
  - Is the streak the daily challenge's or any session's ("Any session today")?
  - Is a shield a freeze? How is one earned, and how many can be held?
  - Are the dots this calendar week or the last 7 days?
  - What do Profile's bars measure (minutes, sessions)?
- **Recommendation:**
  - **The streak:** keep the daily-challenge streak. A second streak would confuse.
  - **Shields:** a shield is a freeze the player holds. One is earned per 7-day run, at most 2 held, and one is spent automatically on a missed day.
  - **Dots:** the current calendar week, Monday first.
  - **Profile bars:** minutes of reading and play per day, from events that already exist.

- **Answer (owner, 2026-11-23):** held freezes (the recommendation).

### Q-WD-07 Leagues (P0, the largest gap)

- **Design:** Leagues, web, plus the Play hub's league card and the Profile header's "Sapphire league". The Leagues page shows:
  - "Sapphire league · 30 players at your pace · ends Sunday · 2d 6h";
  - tabs League / Friends / University / All-time;
  - a table with This week and Points;
  - "top 7 move up to Ruby", "Bottom 5 move down to Gold";
  - tiers Diamond, Ruby, Sapphire, Gold, Silver, Bronze;
  - "How leagues work": grouped weekly with 30 people who play about as much as you; points from matches, battles and reading checkpoints; a new league every Monday;
  - "Your university · #3 of 212 · Verified with college email".
- **Today:** boards (§6.7) by scope and period, one quick-game rating (MATCH-2), monthly seasons (Q-P3-13), battle boards (Q-P5-20). No cohorts, tiers or weekly points.
- **Questions:**
  - **(a) What a league is:** a weekly activity cohort, separate from skill ratings, or a skill tier?
  - **(b) Tiers:** are the 6 final, and where does a new player start?
  - **(c) Cohort:** is the size 30, what happens with fewer, and how is "at your pace" measured?
  - **(d) The week:** which time zone, and what happens to an inactive week?
  - **(e) Points:** for each game, battle and reading checkpoint. Do bot or ghost matches count? Daily caps? Do fair-play penalties remove points?
  - **(f) Moving:** is top 7 / bottom 5 fixed? Ties? Is there a floor and a ceiling?
  - **(g) Boards:** do leagues replace the boards, or become their "League" tab?
  - **(h) University rank:** the universities board? "Verified with college email" conflicts with ADR-0032 (picked from a list, unverified).
  - **(i) Guests (ADR-0029):** are they in leagues?
- **Recommendation:**
  - **League:** a weekly activity cohort, separate from ratings.
  - **Tiers and start:** the 6 tiers; new players start in Bronze.
  - **Cohort:** 30 players, formed Monday 00:00 in the battle-window time zone from players active the previous week, or new.
  - **Points:**
    - a quick-game match 10, a win +5;
    - a battle 30, a win +15;
    - a passed reading checkpoint 10;
    - bot and ghost matches 5;
    - capped at 300 a day;
    - fair-play penalties remove the match's points.
  - **Moving:** top 7 up and bottom 5 down, except Bronze and Diamond.
  - **Boards:** stay as the All-time and University tabs.
  - **University rank:** the existing universities board, without "Verified" (ADR-0032 stands).
  - **Guests:** not in leagues.

  This needs an ADR.

- **Answer (owner, 2026-11-23):** a weekly activity cohort, separate from skill ratings. The owner asked to follow the design, so the design's stated rules hold:
  - a group of 30 who play about as much as you;
  - points from matches, battles and reading checkpoints;
  - a new league every Monday;
  - 6 tiers, Diamond, Ruby, Sapphire, Gold, Silver, Bronze;
  - the top 7 move up and the bottom 5 move down;
  - tabs League / Friends / University / All-time.

  The design doesn't say the rest, so it is the recommendation's, PROVISIONAL until the owner changes it in the ADR:
  - **Points:** a quick match 10 (+5 a win), a battle 30 (+15 a win), a passed checkpoint 10, a bot or ghost match 5, at most 300 a day; fair-play penalties remove a match's points.
  - **Start and edges:** a new player starts in Bronze; nobody leaves Bronze downward or Diamond upward.
  - **The week:** Monday 00:00 in the battle-window time zone.
  - **"At your pace":** last week's active days.
  - **Guests:** not in leagues.
  - **University:** "Verified with college email" stays out, because ADR-0032 (ACCEPTED) has universities picked from a list and unverified.

## Play

### Q-WD-08 vs people / vs AI (P1)

- **Design:** the Play hub header switch.
- **Today:** quick games fall back to bots (BOT-3/BOT-4). The "AI league" in battles means AI tools are allowed, not an AI opponent.
- **Recommendation:** "vs AI" means playing a bot on purpose: every quick game against its bot at once, rated at half (as the fallback is today). Battles stay in their leagues, and the switch doesn't show on the battle cards.

### Q-WD-09 Quick match (P1)

- **Design:** the Play hub's big red card, "Quick match · 2 min · keyboard-first · from your reading".
- **Recommendation:**
  - **The mode:** a one-tap entry into a 1v1 sprint, using questions from concepts the user read in the last 7 days. It's not a new mode.
  - **Keyboard-first:** keys 1–4 answer in every quick game, with "Esc" to leave.
  - **Leaving:** counts as an abandon (the existing rule).

### Q-WD-10 Booked battles (P1)

- **Design:**
  - Play hub: "Booked from your phone · HLD battle tonight at 8:30 PM", a countdown, "You warmed up with 2 drills today", "Practice the canvas", and "The lobby opens 5 minutes early".
  - Home rail: "Tonight · booked".
- **Today:** registration per ranked window (MATCH-7), which closes 5 minutes before. The hero now shows the next window from real data.
- **Recommendation:**
  - **Booked:** means registered for a window; no new concept.
  - **Shown:** on Home and Play when registered.
  - **Left out:** "from your phone" (the device adds nothing).
  - **"Warmed up":** counts practice designs or quick games played today, so it needs no new data.
  - **Lobby opening early:** only if the game server already does it (it doesn't today), so that line stays out.

### Q-WD-11 Weekend HLD cup "bracket of 128" (P2)

- **Recommendation:** no cap; show the registered count instead. Keep the link to the tournament page, where Register already is.

### Q-WD-12 Fastest finger extras (P2)

- **Design:** "First to 4", opponent name and avatar, "won by 0.4s", "Saved to review", the round's topic, option art, keys 1–4 and Esc, "a wrong answer freezes you for 2 seconds".
- **Recommendation:**
  - **Match length:** keep 7 rounds; the design's "first to 4" is the same match ended early once one player can't be caught.
  - **Opponent and margin:** the server sends the opponent's username and the winning margin.
  - **Round topic:** the question's concept name.
  - **Misses:** "Saved to review" is shown after the match, for the player's own misses (it's already applied then).
  - **Keys:** as in Q-WD-09.
  - **Not built:** option art and the freeze rule (one answer per round stays).

### Q-WD-13 Battle results extras (P2)

- **Design:** "Your best move", replay key-moment markers, "Trade-off quality 19/25", rubric "Met / Missed", "scored 3 times, median shown", "Fix it now · 2-minute failover drill", "Concepts to revisit · Added to your feed", "Rematch", the match's duration.
- **Recommendation:**
  - **Wording:**
    - "Met" means level 3 or above.
    - Show "scored 3 times, median shown" (it's true, ADR-0043).
    - Rename "Rubric (AI)" to the design's per-criterion names.
  - **Concepts to revisit:** the rubric's missed criteria map to concepts, and "Concepts to revisit" adds them to the review queue, not the feed (PER rules).
  - **Rematch:** the same opponent, if both press within 60 seconds.
  - **Duration:** show it.
  - **Not built yet:** "best move", key moments and the drill.

## Battles

### Q-WD-14 Live opponent progress (P1)

- **Design:** "RS · 3 of 5 scenarios" (HLD), "RS · 9 of 14 tests" (LLD).
- **Recommendation:**
  - **HLD:** show nothing live. A live score count during a 30-minute design match leaks how close the opponent is to the reference.
  - **LLD:** keep today's best points pill; the game server already sends them.
  - **Rooms:** show only the player's own rank.

### Q-WD-15 Requirement coverage and per-node "Why …?" questions (P2)

- **Design:** "3 of 4 covered", green requirement cards with "Postgres, sharded by short_code", "Nothing covers this yet"; "Why async replication?" with a "scored" badge; "The rubric also looks for …".
- **Recommendation:**
  - **Coverage:** from rules in the problem file (each requirement names the components or scenarios that cover it), not from AI. Shown in practice only.
  - **The note:** stays one free note per node.
  - **Rubric criteria:** never shown during a match.

### Q-WD-16 Run simulation, Leave, drag-in, read-only config (P2)

- **Recommendation:**
  - **Simulation:** keep the automatic preview (CANVAS-5). The bottom button stays "Submit the design".
  - **Leave:** goes to the HLD lobby after a confirm. The design is autosaved and submitted at the deadline as today, so it's not a forfeit.
  - **Drag and drop:** from the palette, as well as click.
  - **Config values:** stay editable, with a warning icon from the existing hints.

### Q-WD-17 LLD extras (P2)

- **Design:** file tabs, "Autosaved", "Stuck? Hints cost points" (Nudge −1, Approach −3, Code sketch −6), the failing test's name with "Jump to line 14", an "EV extension 0/2" row before the reveal, "Score: tests passed, then time".
- **Recommendation:**
  - **Code:** one file. Saved on the server every 10 seconds, so "Autosaved" is true.
  - **Visible test failures:** Velox returns the visible test's name and the line number; hidden tests stay unnamed.
  - **Not built:** hints (they change scoring, and the red-team suite isn't done).
  - **The extension's row:** hidden until the reveal.
  - **Scoring line:** say "tests passed, then time" only if that matches the server's formula (to verify).

## Reading and listening

### Q-WD-18 Pace plan (P1)

- **Design:** "Your plan for DDIA · One session a day", "Sessions a day 1 / 2 / 3", "Finish around …".
- **Recommendation:** a pace per book (default 1 a day). The finish date counts calendar days from today over the sessions left. It affects only that projection, not reminders or the feed.

### Q-WD-19 Link import and EPUB (P1)

- **Design:** "Add a book, PDF or link", the Link tab, "we'll put them in a sensible order as one path", "Drop a PDF or EPUB here".
- **Recommendation:**
  - **EPUB:** yes; the same private pipeline as PDFs.
  - **Links:** wait for a rights decision. A user's link is metadata_only by default (Q-P1-01), so it can't be split into sessions. A "path of saved links" would order the links by concept prerequisites (there's no AI in ordering).

### Q-WD-20 The reader margin (P1)

- **Design:**
  - "In your terms" AI explanation, "Explain differently", "Save to notes";
  - a selection toolbar (Highlight, Note, Explain, Quiz me, keys H/N/E/Q);
  - highlight colours, "Saved to Library · it can turn into a review card", "Quick check · not scored", "Earlier in this chapter";
  - "Aa", "3 min left", "Next page".
- **Recommendation:**
  - **Text layer and highlights:** add PDF.js's text layer. Highlights and notes are stored per user and book. A highlight can become a review card only when the user asks.
  - **Explain:** of the user's own private book, through the gateway, labelled AI, within budget (AI-1, AI-3, OPS-4). It needs an ADR, because Q-P2-38 covered checkpoints only.
  - **"Aa":** controls zoom only.
  - **"3 min left":** derived from the scroll fraction.

### Q-WD-21 Listening to books and the player's extras (P2)

- **Design:** "Listen" and "Listen from here" on books; audio chapters with ticks; a sleep timer; Space and ← → keys; "Save this moment"; "Ask about this"; an Original mode; "Open full transcript"; typed Up-next cards (book sessions, "Review out loud").
- **Recommendation:**
  - **Reading private books aloud:** no for now (TTS cost and privacy).
  - **Chapters:** from the explainer's scene steps.
  - **Keys:** Space and ← → in the player.
  - **Sleep timer:** 15, 30 or 45 minutes, or end of the explainer.
  - **Saving:** "Save this moment" saves the explainer's concept to review.
  - **Not built:** "Ask about this".
  - **Unchanged:** Original stays off, as decided on 2026-11-10.
  - **Transcript page:** yes.

### Q-WD-22 Explore (P1, a new page)

- **Design:**
  - an "Ask anything, or search your library" box with voice and "Ask";
  - prompt chips (Compare two things, Explain like I'm new, Interview drill, Use my stack as the example);
  - a "You asked …" AI answer with source chips, "Ask a follow-up" and "Make it a 4-min session";
  - "A gap worth closing";
  - "Your spaces" (#distributed 3.2k learners · 12 new, …, Find more);
  - "Saved most this week" (Q-WD-03);
  - "Bring your own reading".
- **Today:** Explore isn't scheduled (C-28, Q-P1-42, ADR-0017). There's no search index; the only search ports are people and universities.
- **Recommendation:**
  - **Search:** first, over the catalogue's titles, authors, sources and concepts, plus the user's own saves and notes. Postgres full text, respecting ING-2 (titles and metadata only for metadata_only sources), hidden sources and broken links.
  - **"A gap worth closing":** from concept edges and mastery: one bridge concept between two mastered ones, dismissable.
  - **Spaces:** are the 4 topics. Follow equals the onboarding topics (PER-1). Learner counts appear only above 50.
  - **AI and voice:** "Ask anything" and the AI chips come later, under their own ADR (AI-1: an answer must cite and lead back to reading). No voice input.

- **Answer (owner, 2026-11-23):** build "Ask anything" now as well as search, the gap card and spaces. That needs an ADR first: AI-1 says an answer must cite and lead back to reading, AI-3 says it is stored apart from source text and labelled, and it also needs an OPS-4 budget and an AI-5 eval.

## Onboarding, Library, Profile

### Q-WD-23 Onboarding's new steps (P1)

- **Design:**
  - Step 2: level as three statements ("I know what a database index is…"), topics preselected from the goal, "+ AI infra / + Networking", Connect GitHub inline.
  - Step 3: a 30-second first question, with "Skip for now".
  - Step 4: break times ("While builds or agents run / After lunch / Commute / Evenings", "Weekdays at 1:30 PM") with "Turn on reminders".
  - Also "Finish later", "or press Enter", and "Your first pick, ready on Home".
- **Recommendation:**
  - **Level:** the statements map to beginner, intermediate and advanced.
  - **Topics:** preselected from the goal's topic and changeable.
  - **No new topics** without the ingestion sources behind them.
  - **GitHub:** connects after onboarding, as today, because a redirect mid-flow loses answers.
  - **First question:** from the bank on the first chosen topic. Recorded as mastery evidence; Skip records nothing.
  - **Break times:** replace the single notification hour with up to 3 reminder times. Break length stays.
  - **Keyboard:** Enter advances a step that has an answer.
  - **Not built:** "Finish later" (a feed needs choices) and the live first pick.

### Q-WD-24 Library: memory strength, search, tabs and dates (P1)

- **Design:** "How well you remember" (Strong / Good / Fading / Due bars), "Search saves, highlights and notes", one list with kind tabs and a date column.
- **Recommendation:**
  - **Strength:** FSRS retrievability; Strong ≥ 0.9, Good ≥ 0.75, Fading < 0.75, Due when due. Shows the 8 lowest.
  - **Search:** over titles and note text, in Postgres.
  - **Tabs:** All, Saved, Notes, Listened, with History under All.
  - **Dates:** relative ("Today", "Mon"), in the browser's time zone.

### Q-WD-25 Review card leading with a question (P2)

- **Design:** "Card 1 of 2 · inverted indexes", the question, "Answer hidden until you commit to one", "Answer this one"; the Backlog ("14 cards piled up… Take 5") and Clear states.
- **Recommendation:**
  - **Leading question:** Home pre-picks the first due question and the review starts with it.
  - **Session size:** a review session is capped at 5 cards, so the Backlog state applies.
  - **Clear state:** links to Paths until Explore exists.

### Q-WD-26 Profile: goal skills, header, settings (P2)

- **Design:**
  - "Defend a system design out loud · 3 of 5 core skills strong" with Strong / Next up / Not started;
  - "Aisha K. · Backend engineer · billing-api · Sapphire league", "Edit profile";
  - settings for Break times, "Nudges on this computer", "Topics and sources · 5 topics · 18 sources", "Project context" on/off, "Who sees your rank".
- **Recommendation:**
  - **Core skills:** each goal's core skills are the concepts on its topic's starter path. "Strong" means mastered; "Next up" is the first unmastered in path order.
  - **Header:** a display name (first name and last initial) and an optional role line typed by the user. The repo comes from GitHub when connected.
  - **Settings:**
    - Nudges: a per-device toggle on the agent-hook device.
    - Project context: pauses GitHub reads without disconnecting.
    - Rank visibility: waits for leagues.

### Q-WD-27 Home's hero buttons and rail (P1)

- **Design:** "Listen" and "Something else" on the hero card, "Picked for you", the path card's "7/18" with topic art, and the Library badge "3".
- **Recommendation:**
  - **Listen:** shows only when the card's concept has a ready explainer, and queues it in the player.
  - **Something else:** moves to the next card in the sideways feed (no re-rank).
  - **"Picked for you":** only on cards ranked for the user, not starter cards.
  - **Path progress:** "7/18" counts readings done over readings in the path, skipped included.
  - **Library badge:** the due-review count, on every page.
