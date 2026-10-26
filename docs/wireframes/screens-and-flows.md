# Screens and flows

UI reference only. Product rules come from docs/product.md and docs/decisions.md.

The visual design (owner, 2026-10-26) is in `app-design.html` (16 screens, light and dark) and `design-system.html` (tokens, type, components) in this folder. They are JavaScript bundles: open them in a browser. Where they show behavior the decisions don't have, an ADR comes first.

Extracted from the `SCREENS` and `FLOWS` arrays in docs/wireframes/interval-blueprint-wireframes.html (Oct 22 wireframes). Text is copied verbatim. Known disagreements with the Oct 23 blueprint: docs/conflicts.md.

## Screens

### Mobile · learning

| #   | ID        | Name           | Purpose                                                                                 |
| --- | --------- | -------------- | --------------------------------------------------------------------------------------- |
| 01  | `onboard` | Onboarding     | Topics, level, break length and formats in under a minute.                              |
| 02  | `home`    | For You feed   | Time chips decide what the feed shows: continue cards, moments and the daily challenge. |
| 03  | `article` | In-app browser | The publisher’s page, untouched. Interval’s context lives in a sheet below it.          |
| 04  | `explore` | Explore        | Search by concept, follow topic spaces, see what’s trending in them.                    |
| 05  | `paths`   | Learning paths | Books and topics split into sessions, with checkpoints between sections.                |
| 06  | `reader`  | Book reader    | Original text badged. AI help sits in dashed boxes, apart from the text.                |
| 07  | `listen`  | Audio player   | Expands from the mini-player. Two modes, labeled as original or AI.                     |
| 08  | `library` | Library        | Review queue first, then notes, highlights, history and the knowledge map.              |
| 09  | `profile` | Profile        | Interests, projects, sources, sessions, games and privacy.                              |

### Mobile · play

| #   | ID        | Name              | Purpose                                                                      |
| --- | --------- | ----------------- | ---------------------------------------------------------------------------- |
| 10  | `hub`     | Play hub          | League switch, a recommended game, quick games and desktop battles.          |
| 11  | `match`   | Matchmaking       | Rating band, concepts in play, and the bot fallback.                         |
| 12  | `ff`      | Fastest finger    | Live 1v1. Same questions for both players, timed by the server.              |
| 13  | `est`     | Estimation sprint | Numeric answers with unit keys, scored within a tolerance.                   |
| 14  | `results` | Results           | Outcome and rating, then the missed concept with one button to read the fix. |
| 15  | `lead`    | Leaderboards      | Global, country and university boards with season and mode filters.          |
| 16  | `battles` | Battles on mobile | Desktop handoff, tournaments, replays and spectating.                        |

### Web and desktop

| #   | ID       | Name               | Purpose                                                                          |
| --- | -------- | ------------------ | -------------------------------------------------------------------------------- |
| W1  | `whome`  | Web · For You      | The web feed. Articles open in a new tab while Interval keeps the context panel. |
| W2  | `whub`   | Web · Play hub     | Ratings, quick games, battles, the daily challenge and tournaments.              |
| W3  | `wquick` | Web · Quick game   | Fastest finger on the web, answered with keys 1–4.                               |
| W4  | `hld`    | HLD battle         | Requirements, scenarios, canvas, component settings and trade-off notes.         |
| W5  | `lld`    | LLD battle         | Interface spec, editor, test layers and the extension round.                     |
| W6  | `wres`   | Web · Results      | Score split, rubric with reasons, AI coach and concepts to revisit.              |
| W7  | `wlead`  | Web · Leaderboards | Players and universities, by league, season and mode.                            |
| W8  | `comp`   | Desktop companion  | A menubar window beside the coding agent. Options sized to the time left.        |

### UX notes per screen

**01 Onboarding** (`onboard`)

- Split into three short steps (You, Projects, Play) with a step bar and a time estimate.
- GitHub and university verification moved to their own optional steps, each with Skip.
- Formats carry icons, so Play reads as a first-class way to learn.

**02 For You feed** (`home`)

- With agent hooks on, a banner shows the agent’s time left, and the feed fits that gap.
- Every card says whether it fits the chosen time.
- Save, Test 60s and Why this? stay on the card; tuning controls move to the overflow menu.

**03 In-app browser** (`article`)

- The sheet opens as a one-line peek, so it never covers the author’s page.
- A section rail shows where the moment sits inside the article.
- At the end of a section the sheet offers one next step: test or continue.

**04 Explore** (`explore`)

- Search returns a concept card first, with your state and every format that covers it.
- The level toggle sits on the concept card, where it changes the explanation.
- Each topic space shows whether you follow it.

**05 Learning paths** (`paths`)

- Checkpoints are their own steps on the timeline, with the pass mark and what they unlock.
- Locked sections say what unlocks them.
- Edit (pause, reorder, skip) sits in the header instead of a hidden menu.

**06 Book reader** (`reader`)

- The Original text badge stays pinned while you scroll.
- The footer shows time left in the session and what comes next.

**07 Audio player** (`listen`)

- A line under the mode switch says when you are hearing AI, not the author.
- Up next follows the concept graph to a connected concept.

**08 Library** (`library`)

- The review queue is the top card, with a count, where items came from and a time estimate.
- Knowledge-map states use shape and fill with a legend, not color alone.

**09 Profile** (`profile`)

- Project context, code reading and agent task topic are three separate switches, each labeled On or Off.
- Inferred interests show a count to review, so explicit choices always win.

**10 Play hub** (`hub`)

- A one-line rule under the league switch says what the league measures.
- One recommended game, chosen from concepts due for review, sits above the grid.

**11 Matchmaking** (`match`)

- A countdown ring shows when the rated bot takes over.
- Play bot now skips the wait.

**12 Fastest finger** (`ff`)

- Locked answers and the opponent’s status use an icon and a word, not color alone.
- The same question card powers Test 60s and checkpoints, with instant feedback in solo modes.

**13 Estimation sprint** (`est`)

- After a miss, the screen shows the expected value, so the miss teaches something.
- Unit keys (k, M) and a unit picker keep entry fast on a phone.

**14 Results** (`results`)

- The main button opens the reading that fixes the missed concept; Rematch is secondary.
- The screen says the concept also went to the review queue.

**15 Leaderboards** (`lead`)

- Your own row is pinned below the top five, with rank and percentile.
- Filters are chips in one row, so the season stays visible.

**16 Battles on mobile** (`battles`)

- Handoff offers a link now or a reminder for later.
- Registration status shows on the tournament row.

**W1 Web · For You** (`whome`)

- New screen: most publishers block embedding on the web, so a context panel stays beside the feed for the article open in another tab.
- Mark section done records progress when the publisher page can’t report it.

**W2 Web · Play hub** (`whub`)

- The tournament card shows registration state and when the lobby opens.
- The quick-games heading tells you answers use keys 1–4.

**W3 Web · Quick game** (`wquick`)

- Round history shows which concepts you won or lost as the match goes.

**W4 HLD battle** (`hld`)

- Each failed or slow scenario says why in one line.
- The simulation gate is stated on screen: notes count only once Baseline passes.
- The failing component carries a marker on the canvas, and the note shows its length limit.

**W5 LLD battle** (`lld`)

- The extension banner shows the new rule, the tests it adds and the time left.
- A failing test shows the input that broke it and highlights the line.

**W6 Web · Results** (`wres`)

- Each rubric item shows its one-line reason, with a way to dispute it.
- Coach output sits in a dashed AI box marked as not affecting rating.

**W7 Web · Leaderboards** (`wlead`)

- The University tab ranks schools by average rating, with yours highlighted and its latest tournament result.

**W8 Desktop companion** (`comp`)

- Suggestions are sorted to fit the agent’s estimated time, with one marked as the best fit.
- When the agent finishes, one button returns you to the terminal and your place is saved.

## Flows

Each step is `screen ID` (screen variant, where the wireframe has one).

### Agent-waiting session

Reference: Blueprint §7 and §8.3

The use case that gives Interval its identity: a coding agent starts a long task, and the wait becomes a short session.

1. `comp` (W8 Desktop companion, variant `run`): The agent starts a long task. The companion offers picks that fit about four minutes.
2. `est` (13 Estimation sprint): They play a 60-second sprint and miss a question about replication.
3. `comp` (W8 Desktop companion, variant `done`): The agent finishes. Interval saves their place and offers one button back to the terminal.
4. `home` (02 For You feed, variant `after`): Next time they open Interval, the feed leads with the replication concept they missed.

### Learning session

Reference: Blueprint §3.2, §5D and §8.3

Three minutes free: a moment from a Postgres article, tied to the user’s own project, then a quick test.

1. `home` (02 For You feed): They pick 3 min. The feed shows a moment that fits, with a note tied to billing-api.
2. `article` (03 In-app browser): The moment opens on the publisher’s own page. Interval’s sheet stays collapsed.
3. `article` (03 In-app browser, variant `end`): At the end of the section, the sheet offers a 60-second test or the next section.
4. `ff` (12 Fastest finger, variant `test`): They take Test 60s. Each answer gets instant feedback.
5. `results` (14 Results, variant `test`): Connection pooling moves to practiced, and the next section is queued.

### Path checkpoint

Reference: Blueprint §5F and §8.3

Finishing the Replication section of a book path, then passing the checkpoint that unlocks Partitioning.

1. `paths` (05 Learning paths): They resume the last Replication session from the path.
2. `reader` (06 Book reader): The reader shows time left and that the checkpoint comes next.
3. `ff` (12 Fastest finger, variant `cp`): The 60-second checkpoint uses the same engine as quick games.
4. `results` (14 Results, variant `cp`): A pass unlocks Partitioning. The missed concept goes to review.
5. `library` (08 Library): The missed concept waits at the top of the library’s review queue.

### HLD battle

Reference: Blueprint §6.4 and §8.3

A 30-minute system design battle on desktop, from the Play hub to the concept that comes back in the feed.

1. `whub` (W2 Web · Play hub): From the Play hub on desktop, they choose an HLD battle in the Human league.
2. `hld` (W4 HLD battle): They design, run the simulation, read why scenarios fail, and refine.
3. `wres` (W6 Web · Results): Results show the score split, the rubric with reasons, and coach notes.
4. `whome` (W1 Web · For You, variant `battle`): Leader election, the concept they missed, now leads their feed.

### University tournament

Reference: Blueprint §6.4, §6.7 and §8.3

Registering on the phone, playing on desktop, and seeing results roll into university standings.

1. `battles` (16 Battles on mobile): They register for the Weekend HLD cup on mobile and set a reminder.
2. `whub` (W2 Web · Play hub, variant `tour`): On desktop, the Play hub shows they are registered and when the lobby opens.
3. `hld` (W4 HLD battle, variant `tour`): They play their bracket match on the design canvas.
4. `wlead` (W7 Web · Leaderboards, variant `uni`): Results feed into university standings.
