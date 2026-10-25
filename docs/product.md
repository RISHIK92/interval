Source: docs/_source/interval-blueprint-2026-10-23.md, Part I (sections 1–8), lines 13–266. Copied verbatim, except that export escaping (`\*`) is unescaped so Markdown renders (owner-approved 2026-10-25). No words changed.

# Part I — Product  
  
## 1. Vision  
  
Interval is a personal engineering learning platform that turns the small gaps in a developer's day into real learning. It finds existing high-quality technical content, connects it to the user's interests, projects, and current knowledge, and helps them make steady progress across many short sessions. A game layer lets them practice, prove, and compete on what they've learned.  
  
It's built for people who want to learn but drift to Instagram, YouTube, or random browsing when they have a few spare minutes. Above all, it's for developers waiting on AI coding agents like Claude Code, Codex, or Cursor to finish their work.  
  
**Core principle:** Interval doesn't generate its own knowledge library. It discovers, organizes, personalizes, and connects knowledge that already exists. AI is used for discovery, ranking, relevance notes, supplementary explanations, scoring, and question generation. Original authors stay the source of truth, and AI-generated material is always labeled.  
  
**Four pillars:**  
1. **Discover:** relevant articles, case studies, and books from trusted sources.  
2. **Learn continuously:** persistent paths through books and topics, sized to the time available.  
3. **Personalize:** adapt to interests, level, projects, time, history, and format.  
4. **Practice:** quick games and system design battles that test and reinforce what was learned.  
  
**Definition:** a personalized engineering learning platform that brings together existing technical content, ties discovery to each user's knowledge and projects, delivers learning in time-sized moments or full articles, and reinforces it through competitive practice. It's available on the web, on mobile, and right beside the developer's coding agent.  
  
## 2. Target audience  
  
- **Developers using AI coding agents** who have repeated short waits throughout the day.  
- **Software engineers** building depth in system design, backend, infrastructure, databases, and architecture.  
- **Computer science students** preparing for internships and interviews. They compete through university leaderboards and University Cups.  
- **Engineers who learn from blogs, newsletters, and books**, and want those sources organized into progress.  
- **Anyone replacing low-value scrolling** with short, rewarding sessions.  
  
Launch topics are narrow and deep: system design, databases, distributed systems, and backend, covered by about 250 concepts.  
  
## 3. Foundations  
  
### 3.1 The concept graph  
  
The concept graph is the core data model. Concepts are specific technical ideas such as replication lag, connection pooling, consistent hashing, or leader election. They link through relationships like "prerequisite of," "related to," and "applied in."  
  
Everything attaches to concepts:  
- **Content:** articles, book sections, and moments are tagged with the concepts they teach.  
- **Projects:** technologies and dependencies map to concepts.  
- **Learner state:** each user has a state for each concept (unseen, explored, practiced, mastered, or due for review), updated by reading, notes, quizzes, and games.  
- **Questions:** every question tests one or more concepts.  
  
Recommendations, "why this matters" notes, prerequisites, the review queue, checkpoints, game question selection, and the knowledge map are all views of this one graph.  
  
### 3.2 Learning moments and whole articles  
  
The feed offers both formats, and the user's time budget decides which appears. A **moment** is a self-contained section of an article or book, sized to the time available ("Section 2 of 4 · 3 min"), with a "continue from here" pointer. Longer budgets surface full articles. Progress is tracked per moment, so a moment can grow into a full read.  
  
For web articles, a moment is a deep link into the publisher's original page, never a copy:  
- the heading's anchor if it has one  
- otherwise a text fragment link (`#:~:text=`)  
- otherwise the top of the page, with the section title shown on the card  
  
Moments exist only for sources whose rights profile allows internal full-text processing. Every source also has a switch that turns moments off, so a badly structured site falls back to whole articles.  
  
## 4. Application structure  
  
### 4.1 Navigation  
  
| Area | Purpose |  
|---|---|  
| Home (For You) | Feed, time-budget chips, continue cards, daily challenge |  
| Explore | Search across topics, authors, publications, and topic spaces |  
| Paths | Topic paths and books, sessions, checkpoints, progress |  
| Play | Quick games, battles, leagues, leaderboards, tournaments |  
| Library | Saves, notes, highlights, history, review queue, knowledge map, audio queue |  
  
Profile opens from the avatar. Audio is a global mini-player that expands into a full player.  
  
### 4.2 Surfaces  
  
| Surface | Role |  
|---|---|  
| PWA (primary) | The full product on web and phone browsers; battles on desktop browsers |  
| iOS and Android apps (Expo) | In-app browser, background audio, push notifications, haptics |  
| Agent hook CLI | Start and finish events from Claude Code or any agent |  
| Desktop companion | Menubar quick sessions with agent status |  
| VS Code extension | Quick sessions inside the editor; also works in Cursor |  
  
## 5. Learning features  
  
### A. Onboarding and profile  
  
Guest-first: visitors pick topics, a level, and a break length (1–3, 3–8, or 8–15 minutes) and get a feed right away. Signing up keeps their saves and history, merging guest activity into the account. Connecting GitHub is optional. University verification uses a one-time code sent to a college email address.  
  
Explicit choices always override inferred interests, and users can view, edit, or reset anything inferred.  
  
### B. Sources and ingestion  
  
Sources include technical publications, developer communities, company and independent engineering blogs, postmortems, newsletters, talks, and books the user is authorized to use. Launch starts from a hand-curated seed list of 50 to 100 sources.  
  
The ingestion system handles:  
- polling and WebSub push  
- extraction that keeps heading structure  
- canonical URLs and duplicate detection  
- concept tagging and difficulty estimates  
- moment segmentation  
- a rights profile for each source  
- quality signals, link health checks, and paywall awareness  
  
### C. Feed  
  
The feed is ranked for learning value: relevance, quality, novelty, and the user's current journey, not popularity. It mixes familiar interests with concepts just past the edge of the user's knowledge.  
  
Items include moments, whole articles, continue cards, the daily challenge, "test yourself" prompts, and due reviews. Every card says why it was recommended. Controls are More like this, Less like this, Not interested, Save, and Hide source.  
  
### D. Reading  
  
- **PWA:** a card expands with its context, and "Read on site" opens the original page at the right section in a new tab. On return, a prompt asks "Finished this section? Continue to the next?"  
- **Native apps:** the publisher's page loads in a WebView with Interval's bottom sheet on top (why this matters, save, note, Test 60s). A small script scrolls to the section and measures reading progress, so moment completion is detected automatically. It never changes page content.  
  
"Open original website" is always available.  
  
### E. "Why this matters to you"  
  
Short, labeled notes generated from the ranking signal and the user's project context. For example: "Your billing-api runs FastAPI on PostgreSQL. This is the limit you'll hit first." They can include grounded explanations of unfamiliar terms. They never rewrite the author's content.  
  
### F. Paths, books, and checkpoints  
  
- **Topic paths:** ordered sections built from moments across sources. An LLM proposes the order from concept prerequisites, and a person approves it.  
- **Books:** private PDF uploads. Chapters come from the PDF's bookmarks or heading detection, sections become sessions, and an in-app reader saves position. Scanned pages go through OCR.  
- **Checkpoints:** 60-second quizzes between path sections. Passing marks those concepts as practiced and unlocks the next section. Missed concepts go to the review queue.  
  
Interval never invents a book's structure without authorized access and never bypasses DRM.  
  
### G. Audio and visual explainers  
  
- **Concept explainers first:** each concept gets an original explainer, written by AI from several sources with citations. This avoids rights problems and covers every concept.  
- **Article narration:** limited to permitted content (user PDFs, openly licensed material, partner content).  
- **The player:** a global mini-player with background playback, lock-screen controls, a queue, speed control, saved positions, and synced captions.  
- **Visual explainers:** follow the audio launch. Diagrams are synced to the narration and share their component library with the HLD canvas.  
  
Narrated source and AI explanation are always distinguished.  
  
### H. Project-aware recommendations  
  
With permission, GitHub provides repository metadata and dependency files (package.json, requirements.txt, go.mod). Dependencies map to concepts through a curated table. Reading actual code requires a separate opt-in.  
  
### I. Library, review, and knowledge map  
  
The library holds saves, notes, highlights, history, collections, and the audio queue. The review queue is scheduled by FSRS and fed by reading, quizzes, games, and checkpoints. The knowledge map shows the user's slice of the concept graph. Saving keeps the URL and attribution, never the full text.  
  
### J. Search and exploration  
  
Search covers metadata and permitted content by topic, author, publication, technology, and concept. Users can follow topic spaces and ask for explanations at a chosen level. Results always point back to original sources.  
  
### K. Notifications  
  
All opt-in: digests, new posts from followed authors, path reminders, the daily challenge, tournament reminders, and battle windows. Users control quiet hours and frequency.  
  
### L. Adaptive learning  
  
The system learns from completion, saves, skips, feedback, quiz and checkpoint results, and game performance, not clicks. It brings concepts back on a spaced schedule and measures recall and continuity, not screen time.  
  
## 6. Game layer  
  
### 6.1 Entry points and the learning loop  
  
Play is its own layer and tab. The feed (daily challenge, test yourself), the article sheet (Test 60s), paths (checkpoints), and the agent hook and companion all lead into it. Every game ends by sending missed concepts back to reading, and all game results update the concept graph.  
  
### 6.2 Leagues  
  
- **Quick games:** human-only. An AI tool would answer a 6-second question instantly, so an AI league makes no sense there.  
- **Battles (LLD and HLD):** two leagues from launch.  
  
| | Human league | AI league |  
|---|---|---|  
| AI use | None | Any tools |  
| Measures | Individual skill | Person plus tools: orchestration and judgment |  
| Problems | Standard | Bigger scope, vague requirements with an "ask the interviewer" channel, more extension rounds, harsher failure injection |  
| Ratings and leaderboards | Separate | Separate |  
  
### 6.3 Quick games  
  
| Game | Format | Win condition |  
|---|---|---|  
| Daily challenge | Solo, same set for everyone, one attempt | Score and streak; result shares as a card that doesn't reveal the questions |  
| 60-second sprint | Solo or 1v1 | Most correct in 60 seconds |  
| Fastest finger | 1v1 live, 7 rounds | First correct answer takes each round |  
| Estimation | Solo or 1v1 | Scored by how many times off the answer is; full points within ±25% |  
  
Question types: multiple choice, back-of-envelope estimation, picking the right component, spotting the bottleneck, ranking latencies, and trade-off calls.  
  
### 6.4 HLD battles  
  
HLD battles run in desktop browsers, take about 30 minutes, and come in three formats: live 1v1, 4-player rooms, and tournaments, including University Cups.  
  
- **Canvas:** players build designs from typed components and configure each one. Each decision carries a short "why this choice" note.  
- **Simulation:** an analytical model runs the design through load and failure scenarios. It's deterministic and explains every verdict.  
- **Public spec sheet:** component stats are published and change only at season boundaries, with patch notes, like balance patches in a competitive game.  
  
**Scoring:**  
  
| Component | Weight |  
|---|---|  
| Simulation | 60 |  
| Trade-off quality (AI rubric) | 25 |  
| Speed | 15 |  
  
A design that fails the baseline scenario earns no rubric points. The AI judge scores structured input three times and uses the median, with injection hardening and an appeals queue. A post-match AI coach explains improvements but never affects ratings.  
  
**University Cups:** individuals play Swiss-system rounds, then the top 8 play single elimination. A university's score is the total of its top 5 members' points.  
  
### 6.5 LLD battles  
  
LLD battles run in desktop browsers and take about 45 minutes. Formats are live 1v1, 4-player rooms, and tournaments. Launch languages: Python, JavaScript/TypeScript, Java, C++, and Go.  
  
- **Problems:** fixed interfaces, so hidden tests run against any submission.  
- **Test layers:** visible, hidden, concurrency, extension round.  
- **Extension rounds:** requirements change mid-match, rewarding designs that adapt.  
- **Concurrency:** defined per language. Threads for Java, C++, Go, and Python; interleaved async operations for JS/TS.  
- **Scoring:** weighted tests passed, then time. An optional AI code review appears after the match and never affects ratings.  
  
### 6.6 Matchmaking and ratings  
  
- **Quick games:** one shared 1v1 rating at first, split by mode once there are enough players. Matching uses widening rating bands, with ghosts and labeled bots as fallback.  
- **Battles:** ranked play happens in scheduled windows, nightly per region plus weekends, with registration and reminders. The casual queue is always open: if nobody matches within 60 seconds, the player continues solo and unranked against a reference timeline.  
- **Rating systems:** Glicko-2 for 1v1, OpenSkill for rooms, with seasons and soft resets.  
  
### 6.7 Leaderboards  
  
Global, country, university (verified), and friends. Daily boards for the challenge, weekly boards for sprints, and season boards for ratings.  
  
### 6.8 Question bank  
  
- **AI-generated, auto-validated:** a second model must independently reach the same answer before a question goes live. You spot-check a random 10% weekly, plus everything flagged.  
- **Community-submitted (later):** moderated, rated by players, and weighted by contributor reputation.  
- **Hand-written:** used for the daily challenge review, tournaments, and seasons, and retired after use.  
  
Difficulty is recalibrated from real answers. Questions that get flagged or behave oddly are pulled for review.  
  
### 6.9 Fair play  
  
In the human league, signals include paste events, focus changes, impossible answer speeds, code similarity, and code snapshots every 30 seconds. Flags go to review before any penalty, and penalties affect ratings, not accounts. The AI league has no restrictions.  
  
## 7. Agent-waiting surfaces  
  
- **Agent hook CLI (Phase 3):**  
  1. When the agent starts, the hook tells Interval a task has begun.  
  2. If the agent is still running about 45 seconds later, a notification offers a quick session.  
  3. When the agent finishes, Interval saves your place.  
  
  It sends only "started" and "finished" events, never prompts or code. `interval start` and `interval stop` let it work with any agent.  
- **Desktop companion (Phase 7):** a menubar window with time-fitted suggestions and agent status.  
- **VS Code extension (Phase 7):** also covers Cursor.  
  
Nothing depends on these signals. The product works whenever the user has a few spare minutes.  
  
## 8. Success metrics  
  
- **Return rate:** weekly return, daily challenge streaks, and returns after agent waits.  
- **Continuity:** path progress and how often moments grow into full articles.  
- **Recall:** quiz and checkpoint accuracy, and how many concepts reach mastered.  
- **Loop completion:** how often a missed concept leads to reading within 48 hours.  
- **Game health:** wait times, window fill rate, dispute rates.  
- **Publisher value:** attributed clicks to original sources.  
