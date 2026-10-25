# Glossary

Definitions quote or restructure source text. Citations: § = Part I section of docs/product.md; IDs = docs/decisions.md; "Phase N" = docs/roadmap/phase-N.md; C-NN = docs/conflicts.md. Use these names in code. Do not invent synonyms.

**60-second sprint.** A quick game, solo or 1v1: most correct in 60 seconds. §6.3.

**Agent hook** (agent hook CLI). A CLI that tells Interval when a coding agent starts and finishes a task. "It sends only 'started' and 'finished' events, never prompts or code." `interval start` and `interval stop` work with any agent. §7, Phase 3. See C-09, C-10.

**AI league.** The battle league where any AI tools are allowed. It measures "person plus tools: orchestration and judgment", with bigger scope, vague requirements, and an "ask the interviewer" channel. §6.2. See C-15.

**Balance patch.** A change to the public spec sheet's component stats, made only at season boundaries, with patch notes. §6.4, CANVAS-4.

**Bot.** A synthetic opponent "built from question difficulty and real players' answer times". Always labeled, half-weight rating changes, never in ranked battles. BOT-2 to BOT-5. See C-01.

**Casual queue.** The always-open battle queue. "If nobody matches within 60 seconds, the player continues solo and unranked against a reference timeline." §6.6, MATCH-7.

**Checkpoint.** A 60-second quiz between path sections. "Passing marks those concepts as practiced and unlocks the next section. Missed concepts go to the review queue." §5F.

**Coach.** A post-match AI that "explains improvements but never affects ratings". §6.4, CANVAS-6.

**Concept.** A specific technical idea "such as replication lag, connection pooling, consistent hashing, or leader election". Launch covers about 250 concepts. §3.1, §2.

**Concept graph.** "The core data model": concepts linked by relationships. Content, projects, learner state and questions attach to it. Stored in Postgres as node and edge tables queried with recursive SQL. §3.1, DB-2.

**Continue card.** A feed item for unfinished reading. Moments carry a "continue from here" pointer. §3.2, §5C, Phase 1 Week 5.

**Cost budget.** A per-user cap on AI spend, with cost dashboards, present from Phase 1. OPS-4, LOAD-6.

**Daily challenge.** A solo quick game: "same set for everyone, one attempt". Score and streak; the share card does not reveal the questions. Reviewed the day before. §6.3, Q-2.

**Edge types.** The relationships between concepts: "prerequisite of," "related to," and "applied in." §3.1.

**Entitlements.** A capability layer present from Phase 1: "Features check capabilities, so plans can be added later through configuration." OPS-3.

**Estimation.** A quick game, solo or 1v1, "scored by how many times off the answer is; full points within ±25%". §6.3. See C-27.

**Extension round.** A mid-match requirements change with new tests, "rewarding designs that adapt". §6.5.

**Fastest finger.** A quick game: "1v1 live, 7 rounds". The first correct answer takes each round. §6.3.

**Flawed-design catalog.** Per problem family, a set of designs that must each "fail exactly its target scenario" for a variant to be valid. HLDQ-3.

**FSRS.** The spaced-repetition scheduler for the review queue. PER-2, §5I.

**Gate (simulation).** "A design that fails the baseline scenario earns no rubric points." §6.4.

**Ghost.** A replay of a real recorded run, used as an opponent before synthetic bots. BOT-1.

**Golden design.** A reference design the simulator is regression-tested against. CANVAS-3.

**HLD battle.** A high-level design match in desktop browsers, about 30 minutes: live 1v1, 4-player rooms, or tournaments. Scored simulation 60, trade-off quality 25, speed 15. §6.4.

**Human league.** The league where no AI use is allowed. It measures individual skill. §6.2.

**Knowledge map.** The view of "the user's slice of the concept graph". §5I.

**League.** Battles have two leagues from launch, human and AI, with separate ratings and leaderboards. Quick games are human-only. §6.2.

**Learner state.** Each user's state per concept, "updated by reading, notes, quizzes, and games". §3.1. States:
- **unseen**: listed in §3.1. Not defined further.
- **explored**: listed in §3.1. Not defined further.
- **practiced**: set by passing a checkpoint (§5F). Otherwise not defined.
- **mastered**: listed in §3.1; "how many concepts reach mastered" is a recall metric (§8).
- **due for review**: scheduled by FSRS (PER-2).
PER-2 also models mastery as "a probability updated by evidence". How the probability maps to these five states is not specified (docs/questions/phase-1.md Q-P1-05).

**LLD battle.** A low-level design match in desktop browsers, about 45 minutes: live 1v1, 4-player rooms, or tournaments, in Python, JS/TS, Java, C++ and Go. Scored by weighted tests passed, then time. §6.5. See C-03, C-04.

**Moment.** "A self-contained section of an article or book, sized to the time available", with a "continue from here" pointer. For web articles it is "a deep link into the publisher's original page, never a copy". Split at headings into 2 to 8 minute sections. §3.2, ING-4. Not a "chunk", "snippet" or "segment". See C-05.

**Problem family.** An HLD template "with parameter ranges that generate many variants". 6 to 8 at launch. HLDQ-2.

**Quick game.** A short, human-only game. Four: daily challenge, 60-second sprint, fastest finger, estimation. §6.3. See C-02.

**Ranked window.** A scheduled period for ranked battles, "nightly per region plus weekends, with registration and reminders". §6.6, MATCH-7.

**Reference timeline.** What a battle player competes against in solo fallback or practice, instead of a bot. §6.6, BOT-5.

**Review queue.** The library queue "scheduled by FSRS and fed by reading, quizzes, games, and checkpoints". §5I.

**Rights profile.** Per-source setting that "controls what the pipeline may do". ING-2. Levels:
- **metadata only**
- **excerpt**
- **full text for internal processing**: required for moments (§3.2).
- **full text for display (partners)**
The source text gives the level names only. What each permits step by step is open (Q-P1-01).

**Rubric.** The fixed criteria the AI judge scores trade-off quality against, worth 25 of 100 points. Scored three times, median used. §6.4, CANVAS-6.

**Seed list.** The "hand-curated seed list of 50 to 100 sources" ingestion starts from. §5B, ING-6.

**Source.** A content origin: "technical publications, developer communities, company and independent engineering blogs, postmortems, newsletters, talks, and books the user is authorized to use". Each has a rights profile and a switch that turns moments off. §5B, §3.2.

**Spec sheet.** The public, versioned table of HLD component stats. Changes only at season boundaries. §6.4, CANVAS-4.

**Test layers.** LLD test categories: "visible, hidden, concurrency, extension round". Hidden tests never reach the client. §6.5, LLDQ-4.

**Time budget.** The time the user has, chosen with time chips. It "decides which" format appears: moments for short budgets, full articles for longer ones. Onboarding break lengths are 1–3, 3–8 or 8–15 minutes. §3.2, §5A. See C-23.

**Topic path.** "Ordered sections built from moments across sources. An LLM proposes the order from concept prerequisites, and a person approves it." §5F. See C-25.

**Topic space.** Something users "can follow" in Explore; also a candidate generator. Not otherwise defined. §5J, REC-1.

**University Cup.** An HLD tournament: Swiss-system rounds, then a top-8 single-elimination bracket. "A university's score is the total of its top 5 members' points." §6.4. See C-17.

**Variant.** One generated instance of a problem family. Each must be validated: the reference design passes every scenario, and each flawed design fails exactly its target. HLDQ-2, HLDQ-3.

**Whole article.** The full-article feed format, surfaced by longer time budgets. §3.2. See C-23.

**Why-this-matters note.** A "short, labeled" note "generated from the ranking signal and the user's project context". It never rewrites the author's content. §5E, REC-5. See C-24.

