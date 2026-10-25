# Interval — Product Blueprint, Technical Architecture, and Roadmap  
  
\*October 23, 2026\*  
  
\*\*Contents\*\*  
- Part I — Product  
- Part II — Technical architecture and decision log  
- Part III — Roadmap  
- Part IV — Open decisions  
  
---  
  
# Part I — Product  
  
## 1. Vision  
  
Interval is a personal engineering learning platform that turns the small gaps in a developer's day into real learning. It finds existing high-quality technical content, connects it to the user's interests, projects, and current knowledge, and helps them make steady progress across many short sessions. A game layer lets them practice, prove, and compete on what they've learned.  
  
It's built for people who want to learn but drift to Instagram, YouTube, or random browsing when they have a few spare minutes. Above all, it's for developers waiting on AI coding agents like Claude Code, Codex, or Cursor to finish their work.  
  
\*\*Core principle:\*\* Interval doesn't generate its own knowledge library. It discovers, organizes, personalizes, and connects knowledge that already exists. AI is used for discovery, ranking, relevance notes, supplementary explanations, scoring, and question generation. Original authors stay the source of truth, and AI-generated material is always labeled.  
  
\*\*Four pillars:\*\*  
1. **Discover:** relevant articles, case studies, and books from trusted sources.  
2. **Learn continuously:** persistent paths through books and topics, sized to the time available.  
3. **Personalize:** adapt to interests, level, projects, time, history, and format.  
4. **Practice:** quick games and system design battles that test and reinforce what was learned.  
  
\*\*Definition:\*\* a personalized engineering learning platform that brings together existing technical content, ties discovery to each user's knowledge and projects, delivers learning in time-sized moments or full articles, and reinforces it through competitive practice. It's available on the web, on mobile, and right beside the developer's coding agent.  
  
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
  
\*\*Scoring:\*\*  
  
| Component | Weight |  
|---|---|  
| Simulation | 60 |  
| Trade-off quality (AI rubric) | 25 |  
| Speed | 15 |  
  
A design that fails the baseline scenario earns no rubric points. The AI judge scores structured input three times and uses the median, with injection hardening and an appeals queue. A post-match AI coach explains improvements but never affects ratings.  
  
\*\*University Cups:\*\* individuals play Swiss-system rounds, then the top 8 play single elimination. A university's score is the total of its top 5 members' points.  
  
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
  
---  
  
# Part II — Technical architecture and decision log  
  
Context: one engineer, full-time. Stack: TypeScript, Python, and Go. Cloud: AWS managed services. The guiding principle is to use proven technology with few moving parts, and to split out separate services only where a workload behaves differently.  
  
## Architecture  
  
\*\*ARCH-1. A modular monolith, with separate deployables added only when a phase needs them.\*\*  
  
| Phase | Deployables |  
|---|---|  
| 1 | Next.js full-stack app and a Python worker |  
| 3 | Adds the Go game server and Redis |  
| 5 | Adds the code execution engine |  
| 6 | Adds the TypeScript simulation worker |  
  
\*\*ARCH-2. Each language has a strict job.\*\*  
- **TypeScript:** web, mobile, API, shared packages, and the simulation engine.  
- **Python:** ingestion, ML, and AI jobs.  
- **Go:** game servers and the execution engine.  
  
Nothing gets written twice.  
  
\*\*ARCH-3. A monorepo from Phase 4\*\* (pnpm workspaces with Turborepo). Shared packages: types, API client, game protocol client, quiz and scoring logic, design tokens, the diagram component library, and the simulation engine. Next.js and Expo keep separate UI layers.  
  
\*\*ARCH-4. Infrastructure as code with AWS CDK in TypeScript from day one.\*\*  
  
\`\`\`mermaid  
flowchart TD  
    A\[Content sources\] --&gt; B\[Ingestion worker - Python\]  
    B --&gt; D\[(Postgres + pgvector)\]  
    B --&gt; S3\[(S3)\]  
    D --&gt; G\[Concept graph + learner state\]  
    G --&gt; API\[Next.js API - TS\]  
    API --&gt; WEB\[PWA\]  
    API --&gt; APP\[Expo apps\]  
    HOOK\[Agent hook CLI\] --&gt; API  
    API --&gt; EV\[Firehose → S3 → Athena\]  
    G --&gt; QB\[Question bank\]  
    QB --&gt; GS\[Game server - Go\]  
    GS &lt;--&gt; R\[(Redis)\]  
    GS --&gt; EX\[Execution engine - Go\]  
    GS --&gt; SIM\[Simulation worker - TS\]  
    GS --&gt; JUDGE\[AI judge\]  
    GS --&gt; RW\[Rating worker - TS\]  
    RW --&gt; D  
    TTS\[TTS pipeline\] --&gt; CDN\[CloudFront\]  
    S3 --&gt; CDN  
\`\`\`  
  
## Data  
  
\*\*DB-1. PostgreSQL on RDS is the primary database:\*\* users, content, moments, progress, paths, questions, matches, and ratings.  
  
\*\*DB-2. The concept graph lives in Postgres\*\* as node and edge tables queried with recursive SQL. No graph database is needed at this size.  
  
\*\*DB-3. Embeddings use pgvector,\*\* so vector search can be filtered by rights, source, or difficulty in the same query. Revisit past about 10 million vectors.  
  
\*\*DB-4. Search starts as Postgres full-text search combined with vector search.\*\* OpenSearch or Typesense come later if needed.  
  
\*\*DB-5. Events go through Kinesis Data Firehose into S3 and are queried with Athena.\*\* No Kafka or ClickHouse for now.  
  
\*\*DB-6. S3 stores files:\*\* private encrypted PDFs, audio, scene timelines, replays, and code and design snapshots.  
  
\*\*DB-7. Read replicas and time-partitioned tables\*\* as load grows.  
  
## Cache  
  
\*\*CACHE-1. No Redis in Phase 1.\*\* Precomputed feeds live in a Postgres table.  
  
\*\*CACHE-2. ElastiCache arrives in Phase 3\*\* for matchmaking queues, presence, leaderboards, game events across servers, and the execution queue.  
  
\*\*CACHE-3. Leaderboards use Redis sorted sets,\*\* with Postgres snapshots as the source of truth.  
  
\*\*CACHE-4. CloudFront serves static assets, audio, scene files, replays, and the daily challenge.\*\*  
  
## Load handling  
  
\*\*LOAD-1. Stateless API containers on Fargate\*\* that autoscale.  
  
\*\*LOAD-2. The game server uses the match-actor model.\*\* Each match is owned by one server process, behind an Application Load Balancer with WebSockets, and saves a snapshot after every round.  
  
\*\*LOAD-3. Background work uses SQS; real-time work uses Redis.\*\* Execution queue priorities: ranked, then rooms, then casual, then "Run tests."  
  
\*\*LOAD-4. Known spikes get scheduled scaling.\*\* Battle windows, tournaments, and the daily challenge all have predictable start times.  
  
\*\*LOAD-5. Features degrade gracefully.\*\* A cached feed is the fallback, AI notes are optional, audio is pre-generated, and every submission carries an idempotency key.  
  
\*\*LOAD-6. Rate limits and per-user AI cost budgets.\*\*  
  
## Ingestion  
  
\*\*ING-1. A staged, retryable pipeline:\*\* discover, fetch (respecting robots.txt, per-domain rate limits, and conditional requests), extract while keeping headings, normalize (canonical URLs, near-duplicate detection), classify, segment into moments, store.  
  
\*\*ING-2. Each source's rights profile controls what the pipeline may do:\*\*  
- metadata only  
- excerpt  
- full text for internal processing  
- full text for display (partners)  
  
\*\*ING-3. Polling adapts to each source's publishing rate,\*\* scheduled by EventBridge.  
  
\*\*ING-4. Moments are split at headings into 2 to 8 minute sections,\*\* with deep links and a per-source switch to turn them off.  
  
\*\*ING-5. User PDFs use a private pipeline:\*\* text extraction, Textract OCR for scanned pages, bookmarks, then heading detection.  
  
\*\*ING-6. A curated seed list, quality scores, weekly link checks, and an admin page for reviewing tags and section boundaries.\*\*  
  
## Persona and learner state  
  
\*\*PER-1. Three layers that never overwrite each other:\*\* explicit choices (always win), inferred interests (a time-decayed embedding), and concept mastery.  
  
\*\*PER-2. Mastery is a probability updated by evidence.\*\* Reading counts weakly; quizzes and games count strongly. FSRS schedules reviews.  
  
\*\*PER-3. Cold start:\*\* onboarding choices, GitHub mapping, and an optional placement quiz.  
  
\*\*PER-4. A curated table maps technologies to concepts.\*\* An LLM can suggest additions, which you review.  
  
## Recommendation  
  
\*\*REC-1. Candidate generators:\*\* concept gaps, embedding similarity, followed sources, projects, continue items, due reviews, topic spaces.  
  
\*\*REC-2. Rule-based ranking until there's enough data,\*\* then a gradient-boosted model trained on learning outcomes (completion, saves, later correct answers), not clicks.  
  
\*\*REC-3. Re-ranking\*\* for diversity (MMR plus a per-source cap), time fit, and novelty slots.  
  
\*\*REC-4. Thompson sampling\*\* for exploring adjacent topics and new sources.  
  
\*\*REC-5. Explanations come from the top ranking signal,\*\* using a template polished by a small model, and are cached.  
  
## AI  
  
\*\*AI-1. No full summaries of third-party articles that could replace reading them.\*\* Full explainers are produced only for permitted content and for original concept explainers.  
  
\*\*AI-2. Route by difficulty.\*\* A small, fast model handles tagging, notes, and titles. A stronger model handles explainer scripts, question generation, judging, and coaching. Access is through Amazon Bedrock or Anthropic's API.  
  
\*\*AI-3. Grounded and labeled.\*\* Every output cites its source passages and is stored separately from source text.  
  
\*\*AI-4. Generate once per item, personalize lightly.\*\* Offline jobs use batch processing and prompt caching.  
  
\*\*AI-5. Evaluation sets\*\* for tagging, explanations, and judge agreement run on every prompt or model change.  
  
## Questions  
  
\*\*Q-1. Generator-validator pipeline:\*\* one model drafts a question from a specific moment with a citation; a second model answers it without the key; mismatches are rejected.  
  
\*\*Q-2. Spot checks:\*\* a random 10% sample weekly, plus everything flagged. The daily challenge is reviewed the day before.  
  
\*\*Q-3. Difficulty is recalibrated from real answers\*\* using item response theory. Anomalies are pulled for review.  
  
## Matching  
  
\*\*MATCH-1. Glicko-2 for 1v1, OpenSkill for rooms.\*\* Updates are calculated after the match by a TypeScript worker, not the Go server.  
  
\*\*MATCH-2. One shared quick-game rating at first,\*\* split by mode later.  
  
\*\*MATCH-3. Redis queues with widening bands, grouped by region.\*\*  
  
\*\*MATCH-4. Questions come from the concepts both players share,\*\* at a difficulty matched to their average rating.  
  
\*\*MATCH-5. Server-side timing,\*\* compensated by half the measured network round-trip time, capped at 150 ms.  
  
\*\*MATCH-6. Reconnects, abandons, and rooms:\*\* a 10-second reconnect grace period, abandon penalties, and casual rooms that start with 2 or 3 players after a timeout.  
  
\*\*MATCH-7. Battles use scheduled ranked windows plus an always-open casual queue\*\* with a solo fallback.  
  
## Bots  
  
\*\*BOT-1. Ghosts first:\*\* replays of real recorded runs.  
  
\*\*BOT-2. Synthetic bots second,\*\* built from question difficulty and real players' answer times.  
  
\*\*BOT-3. Always labeled.\*\*  
  
\*\*BOT-4. Half-weight rating changes\*\* against ghosts and bots.  
  
\*\*BOT-5. No bots in ranked battles.\*\* Practice uses a reference timeline instead.  
  
## Audio and visual explainers  
  
\*\*TTS-1. A provider abstraction.\*\* The voice is chosen by a blind test on technical scripts (ElevenLabs versus Inworld), with Polly as a cheap fallback.  
  
\*\*TTS-2. A pronunciation dictionary for technical terms.\*\*  
  
\*\*TTS-3. Word-level timestamps are required,\*\* with forced alignment as the fallback.  
  
\*\*TTS-4. Generate once per concept and stream with HLS through CloudFront.\*\* Personalized intros are short separate clips.  
  
\*\*TTS-5. Visual explainers are scene-timeline JSON rendered as SVG,\*\* not generated video, using the shared diagram library that the HLD canvas also uses.  
  
## HLD  
  
\*\*HLDQ-1. A structured problem format:\*\* requirements, numeric targets, traffic shape, scenarios, rubric, concepts, allowed components, and time limit.  
  
\*\*HLDQ-2. 6 to 8 problem families,\*\* each a template with parameter ranges that generate many variants.  
  
\*\*HLDQ-3. Every variant is validated:\*\* the reference design must pass every scenario, and each design in the family's flawed-design catalog must fail exactly its target scenario. Tournament problems are hand-written and retired.  
  
\*\*CANVAS-1. React Flow,\*\* built on the shared diagram library.  
  
\*\*CANVAS-2. Designs are a versioned JSON graph\*\* with a short justification on each decision, saved automatically.  
  
\*\*CANVAS-3. The analytical simulator models:\*\*  
- request types and routing along graph edges  
- cache hit rates, from cache size versus the working set, with a hot-key skew setting  
- utilization and queueing, giving p50 and p99 estimates  
- storage growth over the problem's horizon  
- node, zone, and region failures, by failover mode  
- availability per scenario  
  
Results are deterministic, come with explanations, and are regression-tested against golden designs.  
  
\*\*CANVAS-4. A public, versioned spec sheet\*\* with season-boundary balance patches.  
  
\*\*CANVAS-5. The same TypeScript engine runs in the browser for preview and on the server as the official scorer.\*\*  
  
\*\*CANVAS-6. The AI judge\*\* scores structured input three times with the median used, hardened against injection, with a calibration set of about 50 designs you grade yourself and an appeals queue.  
  
## LLD  
  
\*\*LLDQ-1. A language-neutral interface schema.\*\* Starter code and harnesses are generated for each language, with generated dispatch code instead of reflection.  
  
\*\*LLDQ-2. Reference solutions in all five languages.\*\* Mutation testing runs on the Python reference.  
  
\*\*LLDQ-3. Property-based tests for invariants,\*\* and concurrency rules defined per language.  
  
\*\*LLDQ-4. Hidden tests never reach the client.\*\* Results show only their category.  
  
\*\*EXEC-1. Engine choice by red-team test, not opinion.\*\* The suite tries network access, fork bombs, reading environment variables and other processes, writing outside the temporary folder, reading other submissions, and exhausting memory. Run it against a hardened Velox and against Judge0; whichever passes wins. It reruns before every release.  
  
\*\*EXEC-2. Velox integration:\*\*  
- **Harnesses:** a generated harness reads a JSON scenario from standard input and prints raw results.  
- **Go support:** add a Go language strategy.  
- **Priority queues:** ranked work runs ahead of practice.  
- **Speed:** compile once and run all scenarios in one process.  
- **Performance limits:** set relative to each language's reference solution, timed on identical instance types.  
  
\*\*EXEC-3. Every run is isolated:\*\*  
- a fresh sandbox  
- no network  
- a non-root user  
- a read-only filesystem except a temporary folder  
- limits on CPU, memory, and processes  
- a stripped environment with no inherited secrets  
- hidden tests passed through standard input only  
  
\*\*EXEC-4. Checking happens outside the sandbox.\*\* A trusted checker replays the reference solution and checks invariants on the raw results.  
  
\*\*EXEC-5. Execution workers run on ECS on EC2,\*\* not Fargate, in an isolated private subnet. They autoscale on queue depth and scale up before scheduled windows.  
  
## Security and operations  
  
\*\*OPS-1. Managed auth\*\* (Cognito or equivalent). SES sends university verification codes. Secrets Manager holds credentials.  
  
\*\*OPS-2. Monitoring with CloudWatch and OpenTelemetry.\*\*  
  
\*\*OPS-3. An entitlements layer from Phase 1.\*\* Features check capabilities, so plans can be added later through configuration.  
  
\*\*OPS-4. Per-user cost budgets and cost dashboards from Phase 1.\*\*  
  
## AWS mapping  
  
| Need | Service |  
|---|---|  
| Postgres with pgvector | RDS for PostgreSQL |  
| Cache and real-time state | ElastiCache (Valkey or Redis) |  
| Files and CDN | S3 + CloudFront |  
| API, workers, game server | ECS on Fargate |  
| Execution workers | ECS on EC2, isolated subnet |  
| Web app | Amplify Hosting or Fargate |  
| Background jobs and schedules | SQS + EventBridge Scheduler |  
| Events and analytics | Kinesis Data Firehose → S3 → Athena |  
| OCR | Textract |  
| Email | SES |  
| Secrets | Secrets Manager |  
| Monitoring | CloudWatch + OpenTelemetry |  
| Models | Bedrock or Anthropic API |  
| Voice | External TTS provider, Polly as fallback |  
  
---  
  
# Part III — Roadmap  
  
Solo and full-time. Phases 1 and 2 have firm scopes. Later phases get re-planned with real usage data.  
  
| Phase | Weeks | Delivers |  
|---|---|---|  
| 1 | 1–6 | Learning feed with moments, guest mode, two beta groups |  
| 2 | 7–12 | Notes, mastery, question pipeline, test yourself, review queue, topic paths, PDF books, GitHub |  
| 3 | 13–18 | All four quick games, all leaderboards, Go game server, ghosts and bots, agent hook CLI |  
| 4 | 19–24 | Expo apps for iOS and Android, in-app browser, concept explainer audio |  
| 4.5 | 25–27 | Visual explainers and the shared diagram library |  
| 5 | 28–35 | LLD battles in five languages, rooms, windows, both leagues |  
| 6 | 36–45 | HLD battles, simulation, AI judge, University Cups |  
| 7 | 46+ | Desktop companion, VS Code extension, community questions, institutional features |  
  
## Phase 1 — Learning feed (weeks 1–6)  
  
\*\*Stack:\*\* Next.js full-stack app and a Python worker, with RDS (pgvector), S3, SQS, EventBridge, Firehose, and managed auth. No Redis yet.  
  
\*\*Week 1:\*\*  
- CDK, RDS, S3, SQS, CI/CD  
- the Next.js shell and auth  
- guest sessions that merge into accounts on sign-up  
- invite codes for the two beta groups  
- event tracking, the entitlements layer, and cost budgets  
  
\*\*Week 2:\*\*  
- 50 to 100 seed sources  
- scheduled polling and extraction that keeps headings  
- canonical URLs, duplicate detection, rights flags  
  
\*\*Week 3:\*\*  
- the \~250-concept graph, LLM tagging, difficulty estimates  
- moment segmentation and embeddings per moment  
- the admin review page  
  
\*\*Week 4:\*\*  
- guest-first onboarding  
- ranking that covers moments and whole articles  
- time chips and "why this matters" notes  
- feedback controls  
  
\*\*Week 5:\*\*  
- deep links into sections and the return prompt  
- continue cards, saves, history  
- PWA install  
  
\*\*Week 6:\*\*  
- daily personal use and ranking tuning  
- a script that checks deep links land on the right section  
- Athena queries split by beta group  
- private beta with about 30 students and 30 working developers  
  
\*\*Not in Phase 1:\*\* notes, paths, quizzes, games, audio, GitHub, native apps.  
  
\*\*Done when:\*\*  
- at least 40% of users return the week after signing up  
- at least half of opened items get marked finished  
  
## Phase 2 — Learning depth (weeks 7–12)  
  
\*\*Week 7:\*\* notes, and the mastery table updated by reading.  
  
\*\*Week 8:\*\* the generator-validator question pipeline, spot-check queue, and difficulty calibration.  
  
\*\*Week 9:\*\*  
- the 60-second "test yourself" after moments and articles  
- mastery updates from quiz results  
- the FSRS review queue in the library, with review slots in the feed  
  
\*\*Week 10:\*\* topic paths with LLM-proposed order and your approval, 5 to 8 launch paths, and checkpoints.  
  
\*\*Week 11:\*\* PDF books: private upload, Textract OCR, chapter detection, the reader, saved position.  
  
\*\*Week 12:\*\* GitHub dependency mapping and project-aware notes, then release. GitHub is the buffer: if PDF work slips, it moves to Phase 3.  
  
\*\*Done when:\*\*  
- at least 30% of finished moments lead to a quiz  
- under 2% of questions get flagged  
- quiz takers return more often than non-takers  
  
## Phase 3 — Quick games (weeks 13–18)  
  
\*\*Week 13:\*\*  
- ElastiCache  
- the daily challenge (same set for everyone, reviewed the day before) with share cards  
- solo sprint and solo estimation  
  
\*\*Week 14:\*\* global, country, university (SES verification with a domain list and a manual review queue), and friends leaderboards.  
  
\*\*Week 15:\*\* the Go WebSocket game server: match actors, round engine, timing compensation, reconnects, snapshots.  
  
\*\*Week 16:\*\* matchmaking, Glicko-2 ratings calculated by the worker, live fastest finger and 1v1 sprint.  
  
\*\*Week 17:\*\*  
- ghosts, labeled bots, friend challenge links  
- the agent hook CLI (about 3 days): start and finish events, notification after about 45 seconds, place saved  
  
\*\*Week 18:\*\* WebSocket load testing with k6, fair-play signals, launch.  
  
\*\*First to slip into a Phase 3.5:\*\* friends leaderboards and 1v1 estimation.  
  
\*\*Done when:\*\*  
- at least 40% of daily active users play the daily challenge  
- half of matches start within 10 seconds  
- players return more often than non-players  
- at least 20% of missed concepts lead to reading within 48 hours  
  
## Phase 4 — Native apps and audio (weeks 19–24)  
  
\*\*Week 19:\*\* the monorepo, shared packages, the Expo shell, auth, push notifications.  
  
\*\*Week 20:\*\* native feed, the WebView reader with its bottom sheet, section scrolling, and automatic progress tracking.  
  
\*\*Week 21:\*\* native quick games with haptics and share sheets, leaderboards, paths, and the PDF reader.  
  
\*\*Week 22:\*\*  
- concept explainer scripts  
- the pronunciation dictionary and the voice blind test  
- TTS with timestamps and HLS packaging  
- submit builds to TestFlight and Play internal testing  
  
\*\*Week 23:\*\* the mini-player (react-native-track-player, plus the Media Session API on the PWA), the queue, synced captions.  
  
\*\*Week 24:\*\* opt-in push notifications for digests, path reminders, and the daily challenge, then store launch.  
  
\*\*Done when:\*\*  
- native users retain at least as well as PWA users  
- at least 25% of weekly active users listen to an explainer  
- explainer completion is above 60%  
- push opt-in is above 40%  
  
## Phase 4.5 — Visual explainers (weeks 25–27)  
  
Scene-timeline JSON and the shared SVG diagram library for web and native, which the HLD canvas reuses later.  
  
## Phase 5 — LLD battles (weeks 28–35)  
  
\*\*Week 28:\*\* the red-team suite and the engine decision, Go support, ECS-on-EC2 workers in an isolated subnet, warm pools.  
  
\*\*Week 29:\*\* the interface schema, starter code and harness generators for five languages, the external checker.  
  
\*\*Week 30:\*\* the problem pipeline, reference solutions in five languages, mutation testing, property tests, concurrency rules, the first 6 problems.  
  
\*\*Week 31:\*\* the battle lifecycle in the Go server, timed extension rounds, Run versus Submit, priority queues, the Monaco editor.  
  
\*\*Week 32:\*\* 4-player rooms with OpenSkill, window registration, reminders, scheduled scaling, the casual queue with solo fallback.  
  
\*\*Week 33:\*\* the AI league problem pool and "ask the interviewer" channel, separate ratings, human-league fair play.  
  
\*\*Week 34:\*\* reach 12 to 15 problems, a load test of a window start, a red-team rerun.  
  
\*\*Week 35:\*\* results, the AI code review, replays, beta battles, launch.  
  
\*\*Done when:\*\*  
- at least 80% of window registrants get matched  
- verdicts arrive within 10 seconds for 95% of submissions  
- no sandbox escapes  
- under 3% of results get disputed  
- every problem's tests catch at least 90% of injected bugs  
  
## Phase 6 — HLD battles (weeks 36–45)  
  
\*\*Week 36:\*\* the design schema, the component catalog, spec sheet v1.  
  
\*\*Weeks 37–38:\*\* the simulation engine, the explanation generator, golden-design tests, browser and server builds.  
  
\*\*Week 39:\*\* the React Flow canvas, configuration panels, justification notes, autosave, preview simulation, hints.  
  
\*\*Week 40:\*\* 6 to 8 problem families, the variant generator, flawed-design catalogs, validation, AI league variants.  
  
\*\*Week 41:\*\* the AI judge, calibration set, appeals, the coach.  
  
\*\*Week 42:\*\* match flow, the official simulation worker, scoring with the gate, 1v1 and rooms, windows and the casual queue.  
  
\*\*Week 43:\*\* tournaments: Swiss rounds, the top-8 bracket, university scoring, check-in, admin tools.  
  
\*\*Week 44:\*\* spectating, design replays, results with the rubric, a tournament load test, 2 to 3 hand-written cup problems.  
  
\*\*Week 45:\*\* a practice cup with beta universities, then the first University Cup.  
  
\*\*Done when:\*\*  
- 95% of simulations finish within 2 seconds  
- the judge is within 1 point of your grade on at least 85% of rubric items  
- under 5% of results get disputed  
- every variant passes validation  
- the first cup finishes without a rejudge  
  
## Phase 7 — Agent-waiting surfaces and growth (week 46+)  
  
1. A desktop companion (Electron, or Tauri if a smaller app is worth adding Rust).  
2. A VS Code extension, which also covers Cursor.  
3. More agent integrations, reusing the hook CLI.  
4. Community-submitted questions with moderation and reputation.  
5. Institutional features.  
  
---  
  
# Part IV — Open decisions  
  
1. **Business model and monetization timing:** deferred. The entitlements layer and cost dashboards keep this decision cheap.  
2. **Execution engine:** a hardened Velox or Judge0, decided by the red-team suite in Phase 5.  
3. **Simulator calibration:** how the spec sheet's numbers are tuned and how balance patches are tested.  
4. **Moment source policy:** which sources allow section-level parsing.  
5. **University verification without college email domains.**  
6. **Desktop companion technology:** Electron or Tauri.  
7. **Agent integrations beyond Claude Code:** which agents expose usable start and finish events.  
8. **Product name:** "Interval" is a working name.  
