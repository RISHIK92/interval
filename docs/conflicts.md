# Conflicts between sources

Sources compared:
- **Oct 23**: docs/_source/interval-blueprint-2026-10-23.md (source of truth).
- **HTML**: docs/_source/interval-blueprint-wireframes.html, Oct 22. docs/wireframes/interval-blueprint-wireframes.html is an identical working copy; docs/_source/ is canonical. Authoritative for UI layout and flows only. Section numbers below are the HTML blueprint's own (§1–§12); screen numbers are from docs/wireframes/screens-and-flows.md.
- **Early**: docs/_source/platform-blueprint-early.md. Historical only. It has no section numbers; locations are its bold headings.

Precedence: Oct 23 > HTML for product and technical behavior. HTML wins only on UI layout and flow. Early never wins.

"Needs confirmation" means the precedence rule gives an answer, but the answer drops something the owner may have wanted, or Oct 23 is silent and the HTML is the only statement. These items are carried into docs/adr/0006-conflict-resolutions.md when they affect Phases 1–3. ADR-0006 was ACCEPTED on 2026-10-25 with the owner's per-row answers; it governs where this file says "Needs confirmation".

## Index

| ID | Topic | Affects phase | Needs confirmation |
|---|---|---|---|
| C-01 | Bot fallback timing and bots in ranked play | 3, 5, 6 | yes |
| C-02 | Quick game list (Solo blitz) | 3 | no |
| C-03 | LLD rooms | 5 | no |
| C-04 | LLD launch languages | 5 | no |
| C-05 | Moment deep links | 1 | no |
| C-06 | Navigation and the Listen tab | 1 | yes |
| C-07 | Surfaces: mobile/web split vs PWA-primary + Expo | 1, 4 | yes |
| C-08 | Question bank review | 2 | no |
| C-09 | Agent hook: task-topic opt-in | 3 | no |
| C-10 | Agent time-left estimate in feed and companion | 3, 7 | yes |
| C-11 | Ebook integrations and URL book import | 2 | no |
| C-12 | Audio: smart explain and narration vs concept explainers first | 4 | no |
| C-13 | Rating structure | 3 | no |
| C-14 | Fair-play signals | 3, 5 | no |
| C-15 | AI league tooling | 5, 6 | no |
| C-16 | AI's role in HLD scoring | 6 | no |
| C-17 | University leaderboard aggregation | 3 | yes |
| C-18 | Ingestion methods | 1 | yes |
| C-19 | Per-source user controls | 1 | yes |
| C-20 | Feed card controls and filters | 1 | yes |
| C-21 | Onboarding contents and steps | 1 | yes |
| C-22 | Section completion on the web | 1 | yes |
| C-23 | Opening a card directly surfaces the full article | 1 | yes |
| C-24 | Input to "why this matters" notes | 1, 2 | no |
| C-25 | Who orders a topic path | 2 | yes |
| C-26 | Where the simulation engine runs | 6 | no |
| C-27 | Estimation scoring | 3 | no |
| C-28 | Statements only in the HTML (privacy, admin, Explore, export) | 1+ | yes |
| C-29 | Leagues for quick games | 3 | no |
| C-30 | Manually added projects | 2 | yes |
| C-31 | Battle rooms: ranked placements vs casual rooms | 5, 6 | yes |
| C-32 | Onboarding topic list | 1 | no |
| C-33 | Minor: article sheet Listen action, LLD test weighting | 4, 5 | no |

## Entries

### C-01 Bot fallback timing and bots in ranked play
- **HTML**: "if no live opponent appears within about 15 seconds, the player faces a rated bot at their level" (§6.6). Screen 11: "A countdown ring shows when the rated bot takes over."
- **Early**: "Bots fill matches when no live opponent is available" (Quick games, supporting systems).
- **Oct 23**: quick games use "ghosts and labeled bots as fallback" (§6.6); "Half-weight rating changes against ghosts and bots" (BOT-4); "No bots in ranked battles. Practice uses a reference timeline instead." (BOT-5); casual battle queue: "if nobody matches within 60 seconds, the player continues solo and unranked against a reference timeline" (§6.6, MATCH-7).
- **Wins**: Oct 23. Quick games may fall back to ghosts first (BOT-1), then labeled bots (BOT-2, BOT-3), at half weight (BOT-4). Battles never use bots.
- **Changes build**: yes. Phase 3 matchmaking (Weeks 16–17); Phases 5–6 casual queue. Oct 23 gives no quick-game fallback timeout. The HTML's 15 s is the only number. Needs confirmation.

### C-02 Quick game list
- **HTML**: five games, including "Solo blitz | Solo | Most correct answers in a chosen time" (§6.3).
- **Early**: "Solo: solve as many as possible in x seconds." (Quick games).
- **Oct 23**: four games: daily challenge, 60-second sprint, fastest finger, estimation (§6.3). Phase 3 "All four quick games".
- **Wins**: Oct 23. No Solo blitz.
- **Changes build**: yes, Phase 3. Solo play is covered by solo sprint and solo estimation (Phase 3 Week 13).

### C-03 LLD rooms
- **HTML**: LLD "run live 1v1 and in scheduled tournaments" (§6.5). Open decision: "LLD 4-player rooms" (§12).
- **Oct 23**: "Formats are live 1v1, 4-player rooms, and tournaments" (§6.5). Phase 5 Week 32: "4-player rooms with OpenSkill".
- **Wins**: Oct 23. The HTML open decision is closed.
- **Changes build**: yes, Phase 5.

### C-04 LLD launch languages
- **HTML**: "a sandbox that supports multiple languages" (§6.5). Open decision: "Which languages are supported at launch" (§12).
- **Oct 23**: "Launch languages: Python, JavaScript/TypeScript, Java, C++, and Go" (§6.5); "Reference solutions in all five languages" (LLDQ-2).
- **Wins**: Oct 23.
- **Changes build**: yes, Phase 5.

### C-05 Moment deep links
- **HTML**: "a moment is a pointer into the publisher's original page (a heading anchor or a scroll position) plus metadata" (§3.2).
- **Oct 23**: heading anchor, "otherwise a text fragment link (`#:~:text=`)", "otherwise the top of the page, with the section title shown on the card" (§3.2). ING-4: "with deep links".
- **Wins**: Oct 23. No scroll-position links on the web. Scroll-to-section by script exists only in the native WebView (§5D, Phase 4).
- **Changes build**: yes. Phase 1 Week 3 (segmentation stores the link type), Week 5 (deep links), Week 6 (verification script).

### C-06 Navigation and the Listen tab
- **Early**: "I'd turn Listen into a global mini-player ... That frees a slot, giving: Home, Explore, Paths, Play, Library, Profile." (Navigation change). Profile is a tab.
- **HTML**: five areas; "Profile and preferences open from the avatar. Audio is no longer a tab." (§4.1).
- **Oct 23**: five areas (Home, Explore, Paths, Play, Library); "Profile opens from the avatar. Audio is a global mini-player" (§4.1).
- **Wins**: Oct 23 (HTML agrees). No Listen tab, no Profile tab.
- **Changes build**: yes, Phase 1. Paths, Play and audio are "Not in Phase 1", and Explore has no scheduled week. Which tabs ship in Phase 1 is undecided. Needs confirmation (see docs/questions/phase-1.md Q-P1-19).

### C-07 Surfaces
- **HTML**: "Mobile app | Feed, reading, paths, audio, quick games, ..." and "Web app | Everything on mobile, plus HLD and LLD battles ..." (§4.2); §6.11 mobile/desktop split. Mobile wireframes 01–16 show a native in-app browser (screen 03).
- **Oct 23**: "PWA (primary) | The full product on web and phone browsers"; "iOS and Android apps (Expo) | In-app browser, background audio, push notifications, haptics" (§4.2). Expo arrives in Phase 4.
- **Wins**: Oct 23. Phase 1 is a PWA only. The mobile wireframes are layout references for the PWA at phone width, except screen 03 (native WebView, Phase 4).
- **Changes build**: yes, Phase 1 (layouts) and Phase 4. Needs confirmation that mobile wireframes 01–09 apply to the phone-width PWA.

### C-08 Question bank review
- **HTML**: "AI-generated, human-reviewed. Generated from the concept graph and reviewed before going live." (§6.8).
- **Early**: "AI-generated, human-reviewed, and tagged by concept." (Supporting systems).
- **Oct 23**: "AI-generated, auto-validated: a second model must independently reach the same answer before a question goes live. You spot-check a random 10% weekly, plus everything flagged." (§6.8); Q-1, Q-2. The daily challenge is reviewed the day before (Q-2).
- Related: the HTML says AI questions fill "daily challenges" and hand-written ones are "Reserved for tournaments and ranked seasons" (§6.8). Oct 23 says hand-written questions are "used for the daily challenge review, tournaments, and seasons" (§6.8).
- **Wins**: Oct 23. No human review gate on everyday questions. Daily challenge uses hand-written review per Oct 23.
- **Changes build**: yes, Phase 2 Week 8.

### C-09 Agent hook: task-topic opt-in
- **HTML**: "With separate explicit permission, the topic of the agent's current task can shape what's suggested." (§7). "seeing an agent's current task each require separate opt-in" (§10 Privacy). Screen 09: "Project context, code reading and agent task topic are three separate switches".
- **Oct 23**: "It sends only 'started' and 'finished' events, never prompts or code." (§7).
- **Wins**: Oct 23. No task topic is sent or stored. The Profile switch for agent task topic is dropped; project context and code reading switches stay (§5H).
- **Changes build**: yes, Phase 3 Week 17 (hook) and the Profile screen.

### C-10 Agent time-left estimate
- **HTML**: feed: "When agent hooks are on, a banner with the agent's estimated time left." (§5C, screen 02). Companion "shows the agent's estimated runtime when known" (§7, screen W8).
- **Oct 23**: the hook sends started and finished events; a notification offers a session after about 45 seconds (§7). The feed item list (§5C) has no agent banner. The companion shows "agent status" (§4.2).
- **Wins**: Oct 23 for what the hook sends. Oct 23 is silent on whether Interval may estimate remaining time from start time alone.
- **Changes build**: Phase 3 (feed banner), Phase 7 (companion). Needs confirmation: drop the estimate, or compute it from elapsed time only.

### C-11 Ebook integrations and URL book import
- **HTML**: "Users add books and documents three ways: a supported ebook integration, a PDF upload ..., or a URL." "DRM-protected books work only through supported integrations" (§5F). §10 Privacy lists "ebooks" as an integration.
- **Early**: silent on books.
- **Oct 23**: "Books: private PDF uploads." "never bypasses DRM" (§5F). ING-5: "User PDFs use a private pipeline".
- **Wins**: Oct 23. PDF upload only. No ebook integrations, no URL import.
- **Changes build**: yes, Phase 2 Week 11.

### C-12 Audio modes
- **HTML**: two modes: "Narrate source: reads eligible text aloud." and "Smart explain: an audio-first explanation with short and detailed depths" (§5G). Player has "skipping, a sleep timer ... transitions between connected concepts".
- **Oct 23**: "Concept explainers first: each concept gets an original explainer, written by AI from several sources with citations." "Article narration: limited to permitted content" (§5G). Player list adds "synced captions" and omits sleep timer and skipping. TTS-4: "Generate once per concept". Phase 4: "concept explainer audio".
- **Wins**: Oct 23. Concept explainers come first; article narration exists only for permitted content. No short/detailed depth setting is specified.
- **Changes build**: yes, Phase 4.

### C-13 Rating structure
- **HTML**: "each league and mode family has its own rating, using a Glicko-style system" (§6.6).
- **Early**: "keep a rating per mode (Elo or Glicko)" (Supporting systems).
- **Oct 23**: "Glicko-2 for 1v1, OpenSkill for rooms" (MATCH-1); "One shared quick-game rating at first, split by mode later" (MATCH-2).
- **Wins**: Oct 23.
- **Changes build**: yes, Phase 3 Week 16.

### C-14 Fair-play signals
- **HTML**: "pasted text, focus changes, typing patterns and sudden rating jumps" (§6.10). Early: same list.
- **Oct 23**: "paste events, focus changes, impossible answer speeds, code similarity, and code snapshots every 30 seconds" (§6.9).
- **Wins**: Oct 23. Typing patterns and rating jumps are not listed.
- **Changes build**: yes, Phase 3 Week 18 and Phase 5 Week 33.

### C-15 AI league tooling
- **Early**: "Equal access: an in-app assistant with a fixed budget per match, so everyone has the same tool" (Two leagues).
- **HTML**: "Any tools: Claude Code, Cursor, chat assistants, anything" (§6.2).
- **Oct 23**: "AI use | None | Any tools" (§6.2).
- **Wins**: Oct 23. No in-app assistant.
- **Changes build**: yes, Phases 5–6.

### C-16 AI's role in HLD scoring
- **Early**: first proposes AI "as a coach rather than a judge ... Use it in practice mode, not for ranking", then adopts hybrid scoring later in the same document.
- **HTML / Oct 23**: hybrid 60/25/15 with a simulation gate; the coach "never affects ratings" (§6.4). CANVAS-6 covers the judge only.
- **Wins**: Oct 23.
- **Changes build**: no. Historical only.

### C-17 University leaderboard aggregation
- **HTML**: "The University tab ranks schools by average rating" (screen W7).
- **Oct 23**: for University Cups, "A university's score is the total of its top 5 members' points" (§6.4). Leaderboards: "Global, country, university (verified), and friends" (§6.7), with no aggregation rule for ranking universities against each other.
- Related: the HTML has "university-vs-university brackets" (§6.4, §2). Oct 23 cups are "individuals play Swiss-system rounds, then the top 8 play single elimination" with university totals from top 5 members (§6.4). Oct 23 wins for cups (Phase 6).
- **Wins**: neither covers the same thing. Oct 23 is silent on the university-vs-university leaderboard outside cups.
- **Changes build**: Phase 3 Week 14. Needs confirmation.

### C-18 Ingestion methods
- **HTML**: "RSS and Atom feeds, publisher-approved APIs and permitted crawling" (§5B).
- **Oct 23**: "polling and WebSub push" (§5B); fetch "respecting robots.txt, per-domain rate limits, and conditional requests" (ING-1); EventBridge-scheduled polling (ING-3). Phase 1 Week 2 lists "scheduled polling" only.
- **Wins**: Oct 23. Compatible in substance; Oct 23 does not mention publisher APIs.
- **Changes build**: Phase 1 Week 2. Needs confirmation whether WebSub is in Phase 1 (see Q-P1-07).

### C-19 Per-source user controls
- **HTML**: "Users can follow, mute, unfollow and prioritize any source." (§5B).
- **Oct 23**: card controls include "Hide source" (§5C). Following exists: REC-1 "followed sources", §5J "Users can follow topic spaces", §5K "new posts from followed authors". Mute and prioritize appear only in the HTML. No Phase 1 week schedules following.
- **Wins**: following is in Oct 23, so this is a scoping call, not a precedence win. Mute and prioritize are HTML-only and not adopted.
- **Changes build**: Phase 1 Week 4. Needs confirmation whether following sources ships in Phase 1 or later.

### C-20 Feed card controls and filters
- **HTML**: "Save, Test 60s and Why this? stay on the card. More like this, Less like this, Not interested and Hide source sit in its overflow menu. Filters cover topic, author, source, difficulty, format and time." (§5C).
- **Oct 23**: "Controls are More like this, Less like this, Not interested, Save, and Hide source." (§5C). No filters.
- **Wins**: placement is UI, so HTML. The control set is Oct 23. Test 60s is Phase 2 (quizzes are "Not in Phase 1"). Filters are not in Oct 23.
- **Changes build**: Phase 1 Week 4. Needs confirmation that filters are out.

### C-21 Onboarding contents and steps
- **HTML**: "three short steps. Users pick topics, a familiarity level, a typical break length ..., and preferred formats: read, diagrams, listen or play." (§5A). Screen 01: steps "You, Projects, Play"; GitHub and university verification as optional steps.
- **Oct 23**: "visitors pick topics, a level, and a break length (1–3, 3–8, or 8–15 minutes) and get a feed right away" (§5A). No formats.
- **Wins**: Oct 23 for what is collected. HTML for step layout.
- **Changes build**: Phase 1 Week 4. GitHub is Phase 2, university verification is Phase 3, Play is Phase 3. Needs confirmation whether Phase 1 onboarding is one step, and whether formats are collected.

### C-22 Section completion on the web
- **HTML**: "articles open in a new tab and the context panel stays on Interval's side, with a Mark section done control." (§5D, screen W1).
- **Oct 23**: "'Read on site' opens the original page at the right section in a new tab. On return, a prompt asks 'Finished this section? Continue to the next?'" (§5D).
- **Wins**: Oct 23 for behavior (return prompt). HTML layout for the context panel.
- **Changes build**: Phase 1 Week 5. Needs confirmation whether a persistent Mark section done control also exists.

### C-23 Opening a card directly surfaces the full article
- **HTML**: "A longer budget, or opening a card directly, surfaces the full article." "a half-read article resumes as its next moment" (§3.2).
- **Oct 23**: "the user's time budget decides which appears" and "Progress is tracked per moment, so a moment can grow into a full read" (§3.2). This covers resuming a half-read article. It is silent on opening a card directly.
- **Wins**: Oct 23 is silent on the open-a-card case; no conflict to resolve by precedence.
- **Changes build**: Phase 1 Weeks 4–5. Needs confirmation.

### C-24 Input to "why this matters" notes
- **HTML**: "generated from the concept graph and the user's project context" (§5E).
- **Oct 23**: "generated from the ranking signal and the user's project context" (§5E); "Explanations come from the top ranking signal, using a template polished by a small model, and are cached." (REC-5).
- **Wins**: Oct 23. Project context arrives with GitHub in Phase 2, so Phase 1 notes use the ranking signal only.
- **Changes build**: Phase 1 Week 4, Phase 2 Week 12.

### C-25 Who orders a topic path
- **HTML**: "Users can pause, reorder, skip or change a path from the Edit control" (§5F).
- **Oct 23**: "An LLM proposes the order from concept prerequisites, and a person approves it." (§5F).
- **Wins**: Oct 23 for authoring. Oct 23 is silent on per-user edits.
- **Changes build**: Phase 2 Week 10. Needs confirmation.
- **Resolved (owner, 2026-10-28)**: the owner approves each path's order; users get full edits on their own copy (pause and resume, reorder, skip, swap a session's moment). Q-P2-23.

### C-26 Where the simulation engine runs
- **HTML**: "the simulation engine and test runner run in isolated sandboxes" (§9, Real-time notes).
- **Oct 23**: "The same TypeScript engine runs in the browser for preview and on the server as the official scorer." (CANVAS-5). Sandboxing applies to code execution (EXEC-3).
- **Wins**: Oct 23.
- **Changes build**: Phase 6.

### C-27 Estimation scoring
- **HTML**: "Numeric answers scored within a tolerance (for example ±25%)" (§6.3).
- **Oct 23**: "Scored by how many times off the answer is; full points within ±25%" (§6.3).
- **Wins**: Oct 23. Partial credit by ratio.
- **Changes build**: Phase 3 Week 13.

### C-28 Statements only in the HTML
Oct 23 is silent on these. They are not adopted unless confirmed.
- "Users can export or delete their data and reset inferred interests." (§10 Privacy). Oct 23 covers reset only (§5A). Affects guest data handling in Phase 1.
- "Content-removal and licensing requests are handled through admin tools." (§10 Content rights). Oct 23's admin page (ING-6) covers tags and section boundaries only. Affects Phase 1 Week 3.
- "University verification stores only the affiliation, not the email contents." (§10 Privacy). Phase 3.
- Explore shows "what's trending" in topic spaces (screen 04). Oct 23 does not address trending in Explore (§5C's "not popularity" is about the feed), and schedules no Explore work in any phase.
- "Notes and links are exportable." (§5I). Oct 23 is silent. Phase 2 (notes).
- "The architecture stays open to other knowledge domains." (§2). No build impact.

### C-29 Leagues for quick games
- **HTML**: Play hub has a "League switch, a recommended game, quick games" (screen 10); "each league and mode family has its own rating" (§6.6); boards filter "by league, mode and season" (§6.7).
- **Oct 23**: "Quick games: human-only. An AI tool would answer a 6-second question instantly, so an AI league makes no sense there." (§6.2).
- **Wins**: Oct 23. The league switch applies to battles only.
- **Changes build**: Phase 3 Play hub and leaderboards.

### C-30 Manually added projects
- **HTML**: "Users add projects manually or through GitHub with explicit permission." (§5H).
- **Oct 23**: GitHub only: "With permission, GitHub provides repository metadata and dependency files" (§5H).
- **Wins**: Oct 23. No manual projects.
- **Changes build**: Phase 2 Week 12. Needs confirmation.

### C-31 Battle rooms
- **HTML**: HLD has "live 4-player rooms with ranked placements" (§6.4).
- **Oct 23**: "4-player rooms" (§6.4, §6.5), OpenSkill for rooms (MATCH-1), and "casual rooms that start with 2 or 3 players after a timeout" (MATCH-6).
- **Wins**: Oct 23. Whether rooms are ranked, casual, or both is not stated outright.
- **Changes build**: Phases 5–6. Needs confirmation.

### C-32 Onboarding topic list
- **HTML**: onboarding chips include "AI infrastructure", "Networking", "DevOps", "Security" (wireframe script, screen 01).
- **Oct 23**: "Launch topics are narrow and deep: system design, databases, distributed systems, and backend, covered by about 250 concepts." (§2).
- **Wins**: Oct 23. Four launch topics.
- **Changes build**: Phase 1 Week 3 (concept list, Q-P1-03) and Week 4 (onboarding).

### C-33 Minor differences
- Article sheet: HTML "Save, Note, Listen and Test 60s" (§5D) vs Oct 23 "why this matters, save, note, Test 60s" (§5D). No Listen. Phase 4.
- LLD scoring: HTML "tests passed" (§6.5) vs Oct 23 "weighted tests passed, then time" (§6.5). Phase 5.
- Both resolved by precedence (Oct 23). No confirmation needed.

### C-34 A short intro and the 2-minute rule (found 2026-10-26, P1-W3-S03)
- **Q-P1-06 default (accepted)**: "Section under 2 min: merge with the next sibling section (or previous, if last) until ≥ 2 min."
- **Q-P1-06 addition (owner, 2026-10-25, P1-W1-S05)**: "text before the first section heading is its own moment, linked to the top of the page."
- **Collision**: an intro under 2 minutes (most intros) is either its own short moment or merged into the first section; both rules can't hold.
- **Built**: the owner's later, more specific wording wins, so the intro is always its own moment, even under 2 minutes. Headed sections follow the merge rule.
- **Changes build**: P1-W3-S03 segmentation. Needs the owner's confirmation.

### C-35 Metadata sent to a third-party model (found 2026-10-26, P1-W3-S02)
- **Q-P1-01 matrix**: metadata only stores title, author, date, URL and the feed summary "as published"; no body fetch, no moments, no embeddings of body text. It says nothing about sending metadata to a model.
- **P1-W3-S02**: "each item and moment gets concept tags". Q-P1-39 ranks metadata-only items "by metadata-only signals".
- **Built**: metadata-only items are tagged from their title and feed summary, and excerpt items also from their stored excerpt (the matrix stores it "for tagging"). Body text goes to the model only under full-text rights.
- **Changes build**: P1-W3-S02 tagging. Needs the owner's one-line confirmation that title and summary may go to OpenRouter.

### C-36 What "cites its source passages" means for tags (found 2026-10-26, P1-W3-S02)
- **AI-3**: "Every output cites its source passages and is stored separately from source text."
- **Built**: moment tags are stored per moment, and a moment is a deep link to its passage. Item tags cite the item. The model sees at most 4,000 characters per moment, and which characters it saw is not recorded.
- **Open**: whether a per-moment tag is citation enough for tags, or AI-3 applies only to generated text (notes, explainers). Needs the owner.

## Source file notes

These are not disagreements, but they affect the verbatim copies.
- The Oct 23 file is an export with escaped Markdown: `\*`, `\[`, `\~250`, and the mermaid block fenced as `` \`\`\`mermaid `` with `--&gt;` arrows. On 2026-10-25 the owner approved unescaping markup (no word changes) in docs/decisions.md and docs/product.md, so the diagram now renders. docs/roadmap/phase-*.md got the same cleanup the same day.
- The HTML is dated 22 October 2026 and calls itself the "final product" blueprint. The Oct 23 file supersedes it.
