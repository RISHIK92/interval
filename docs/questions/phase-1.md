# Phase 1 questions

Gaps, ambiguities and underspecified points that block or risk Phase 1 (docs/roadmap/phase-1.md). Each has a suggested default that applies only if the owner accepts it. None of the defaults are decisions.

Priority: **P0** blocks a Week 1–2 slice; **P1** blocks a later slice; **P2** a risk, not a blocker.

Status: all 42 answered by the owner on 2026-10-25. Each answer appears under its question and overrides the suggested default.

## Content and rights

### Q-P1-01 Rights profile: who sets it, the default, and what each level permits (P0)
- Cite: ING-2, §3.2, §5B, ING-6, Part IV item 4 ("Moment source policy").
- Why it matters: every pipeline step is gated by the profile (CLAUDE.md invariant). The source text names four levels but not what each permits (fetch body? store extracted text? embed? show excerpt length?). It also does not say who sets the profile or how the seed list records it.
- Blocks: P1-W1-S04 (skeleton ingest), P1-W2-S01 (sources), P1-W2-S05 (extraction), P1-W3-S03 (segmentation), P1-W3-S04 (embeddings).
- Suggested default: the owner sets it per source in the seed list file; there is no automatic assignment. New sources default to **metadata only**. A permission matrix, by level:
  - metadata only: store title, author, date, canonical URL, feed summary as published. No body fetch beyond what is needed to read metadata. No moments, no embeddings of body text.
  - excerpt: as above, plus store up to N characters (owner to set N) for tagging and display. No moments.
  - full text for internal processing: fetch and extract body; store extracted text privately for tagging, segmentation and embeddings; never display body text; section titles and "Section 2 of 4" positions may be shown on cards (§3.2); moments allowed.
  - full text for display (partners): as above, plus display.
- **Answer (owner, 2026-10-25):** Owner sets the profile per source in the seed file. New sources default to metadata only. Permission matrix accepted as stated. Excerpt cap: 300 characters. Added 2026-10-25 (P1-W1-S04 review): the feed summary is stored as plain text capped at 300 characters, and never taken from full content; lowering a profile deletes stored text the new profile forbids; an excerpt is stored only under the `excerpt` profile.
  The seed list file records `rights_profile` and `moments_enabled` per source.

### Q-P1-02 Seed list: contents and format (P0)
- Cite: §5B ("hand-curated seed list of 50 to 100 sources"), ING-6, Phase 1 Week 2.
- Why it matters: Week 2 ingests it. Which sources, which feed URLs, and which rights profiles is owner knowledge.
- Blocks: P1-W1-S04 (one source), P1-W2-S01 (full list).
- Also open: sources without a feed (newsletters, talks, communities in §5B). Candidate names from the HTML (§5B: ByteByteGo, DEV, Medium, Devpost) are placeholders per its footer; the owner confirms each.
- Suggested default: a YAML file in the repo (`workers/ingest/seeds/sources.yaml`) with name, homepage, feed URL (optional; feedless sources are skipped in Phase 1), rights profile, moments enabled, paywalled, topics. The owner writes the first 10 entries for the vertical path; the rest arrive before Week 2 ends.
- **Answer (owner, 2026-10-25):** YAML in the repo at `workers/jobs/seeds/sources.yaml`, with the proposed fields. Feedless sources are skipped in Phase 1. The owner writes the first 10. Changed 2026-10-25: Claude drafts the first 10 in docs/proposals/seed-sources.md, and the owner approves them.

### Q-P1-03 Where the ~250 concepts come from (P0 for Week 3)
- Cite: §2 ("about 250 concepts"), §3.1, DB-2, Phase 1 Week 3.
- Why it matters: tagging needs a fixed concept list. An LLM-generated list would be invented product content.
- Blocks: P1-W3-S01, P1-W3-S02.
- Suggested default: an LLM drafts a candidate list per launch topic (system design, databases, distributed systems, backend); the owner edits and approves it; it is stored as a versioned seed file and loaded by migration or seed script.
- **Answer (owner, 2026-10-25):** An LLM drafts the list per launch topic; the owner edits and approves it; stored as a versioned seed file.

### Q-P1-04 Concept graph schema and versioning (P1)
- Cite: §3.1 (edge types "prerequisite of," "related to," "applied in"), DB-2.
- Why it matters: content tags and learner state reference concepts. Renaming, merging or splitting a concept later must not orphan them.
- Blocks: P1-W3-S01.
- Suggested default: `concept(id, slug, name, description, topic, created_at, retired_at, merged_into)` and `concept_edge(from_id, to_id, type)` with `type` limited to the three edge types. Concepts are never deleted: retired or merged, with tags migrated by script. Graph changes are recorded by a `graph_version` integer bumped on each approved change.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-05 Learner states in Phase 1 (P1)
- Cite: §3.1 (five states), PER-2 ("Mastery is a probability updated by evidence. Reading counts weakly"), Phase 2 Week 7 ("the mastery table updated by reading").
- Why it matters: the mastery table is Phase 2. Phase 1 ranking (REC-1 "concept gaps") may still want unseen vs explored.
- Blocks: P1-W4-S02 (candidate generation).
- Suggested default: Phase 1 derives "seen concepts" from the Postgres progress and history tables (DB-1). DB-5 events go to S3/Athena and are not readable by the online ranker. No learner-state table until Phase 2.
- **Answer (owner, 2026-10-25):** Derive seen concepts from Postgres progress and history. No learner-state table in Phase 1.

### Q-P1-06 Moment segmentation edge cases (P0 for Week 3)
- Cite: ING-4 ("split at headings into 2 to 8 minute sections"), §3.2.
- Why it matters: real articles break the rule. The source text does not cover them.
- Blocks: P1-W1-S05 (skeleton), P1-W3-S03.
- Suggested defaults:
  - No headings: no moments; whole article only.
  - Section under 2 min: merge with the next sibling section (or previous, if last) until ≥ 2 min.
  - Section over 8 min: split at the next lower heading level; if none, keep as one moment flagged `oversized` for the admin page. Do not split mid-paragraph (it would need a text-fragment link to an arbitrary sentence).
  - Code-heavy sections: count code blocks at a lower reading speed (owner to set), never split inside a code block.
  - Reading speed: 230 words per minute for prose (assumption; owner to confirm).
- **Answer (owner, 2026-10-25):** Defaults accepted, at 230 words per minute. Code counts at the same rate as prose.

### Q-P1-07 WebSub in Phase 1 (P2)
- Cite: §5B ("polling and WebSub push"), ING-3, Phase 1 Week 2 ("scheduled polling"), C-18.
- Suggested default: polling only in Phase 1 (see ADR-0006).
- **Answer (owner, 2026-10-25):** WebSub after Phase 1 (ADR-0006 C-18).

### Q-P1-08 Canonical URLs and near-duplicate threshold (P1)
- Cite: ING-1 ("canonical URLs, near-duplicate detection"), Phase 1 Week 2.
- Blocks: P1-W2-S06.
- Suggested default: canonical = `<link rel="canonical">` if same-site, else the final URL after redirects with tracking params stripped. Near-duplicate = SimHash over extracted text with a Hamming distance ≤ 3 (only for sources whose profile allows body processing; otherwise title + author + date match). Keep the earliest-published item; link the rest.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-09 Paywall awareness (P2)
- Cite: §5B ("paywall awareness"), §5D.
- Suggested default: a per-source `paywalled` flag set by the owner in the seed list; cards for paywalled items show a label. No detection in Phase 1.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-10 Difficulty estimate scale (P1)
- Cite: §5B ("concept tagging and difficulty estimates"), Phase 1 Week 3; onboarding "level" (§5A).
- Why it matters: ranking must compare item difficulty with the user's level, and the level options are not defined.
- Blocks: P1-W3-S02, P1-W4-S01.
- Suggested default: three levels (beginner, intermediate, advanced) for both the user and items; LLM tagging assigns one per moment and per article.
- **Answer (owner, 2026-10-25):** Three levels: beginner, intermediate, advanced.

## Ranking and feed

### Q-P1-11 Guest merge conflict rules (P0)
- Cite: §5A ("Signing up keeps their saves and history, merging guest activity into the account"), Phase 1 Week 1.
- Why it matters: a guest can sign in to an existing account on a device where they already have guest activity.
- Blocks: P1-W1-S12.
- Suggested default:
  - New account: the guest row becomes the account (same `user_id`).
  - Existing account: saves: union. History and events: union, keep guest event timestamps. Reading progress per moment: keep the further progress. Hidden sources and Not interested: union. Explicit onboarding choices (topics, level, break length): the account's choices win and the guest's fill only fields the account never set. This is an owner choice; PER-1 does not rank one explicit choice above another. Merge is idempotent (LOAD-5) and emits a `guest_merged` event.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-12 Guest session lifetime and cleanup (P1)
- Cite: §5A; C-28 (data deletion).
- Suggested default: 90-day sliding cookie. Guest rows with no activity for 90 days are deleted by a scheduled job.
- **Answer (owner, 2026-10-25):** 30-day sliding cookie. Inactive guests deleted after 30 days.

### Q-P1-13 What "rule-based ranking" means in Phase 1 (P0 for Week 4)
- Cite: REC-2 ("Rule-based ranking until there's enough data"), REC-1, REC-3, REC-4, §5C, Phase 1 Week 4.
- Why it matters: the owner must approve the scoring rules; an invented formula is invented product behavior.
- Blocks: P1-W4-S02, P1-W4-S03.
- Suggested default: candidates from REC-1 generators that have data in Phase 1: concept match to chosen topics, embedding similarity to saved/finished items, continue items. Score = weighted sum of: topic match, level fit (Q-P1-10), source quality score (ING-6), freshness, time fit to the chosen chip, minus penalties for Less like this / Not interested / hidden source. Re-rank with a per-source cap and MMR (REC-3). Thompson sampling (REC-4) deferred to Week 6 tuning or later. Weights in one config table, tuned by the owner in Week 6.
- **Answer (owner, 2026-10-25):** Accepted, and Thompson sampling (REC-4) is in Phase 1.

### Q-P1-14 Signals before any user data (P1)
- Cite: PER-3 ("Cold start: onboarding choices, GitHub mapping, and an optional placement quiz"). GitHub is Phase 2; quizzes are not in Phase 1.
- Suggested default: cold start uses onboarding topics, level and break length only.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-15 Feedback control semantics (P1)
- Cite: §5C (More like this, Less like this, Not interested, Save, Hide source), PER-1.
- Why it matters: each control must change ranking in a defined way, and inferred interests must never overwrite explicit choices.
- Suggested default: More/Less like this move the inferred interest embedding toward or away from the item (PER-1 defines that layer as "a time-decayed embedding"). Not interested removes the item from that user's feed; whether that is permanent is an owner choice. Hide source removes the source for that user (an explicit choice, reversible from settings, Q-P1-36). None of them change the user's explicit topic choices.
- **Answer (owner, 2026-10-25):** More/Less like this as suggested. Not interested hides the item and down-ranks its concepts in the inferred layer. Hide source as suggested.

### Q-P1-16 Time chips and break lengths (P1)
- Cite: §3.2, §4.1 ("time-budget chips"), §5A (1–3, 3–8, 8–15 minutes).
- Suggested default: three chips matching the onboarding ranges (1–3, 3–8, 8–15 min), as in the HTML wireframe. The budget decides the format (§3.2): which chip surfaces whole articles is an owner choice (proposed: 8–15). The chosen chip persists per session; the onboarding value is the default.
- **Answer (owner, 2026-10-25):** Three chips (1–3, 3–8, 8–15). 1–3 and 3–8 show moments; 8–15 shows whole articles that fit, plus long moments.

### Q-P1-17 Precomputed feed refresh and fallback (P1)
- Cite: CACHE-1 ("Precomputed feeds live in a Postgres table"), LOAD-5 ("A cached feed is the fallback").
- Suggested default: recompute a user's feed on a schedule (hourly) and after any feedback action, by the Python worker or the Next.js app (owner to choose; ranking language is not set in ARCH-2 — "ML" is Python, "API" is TS). If live ranking fails, serve the last stored feed and log a metric.
- **Answer (owner, 2026-10-25):** Hourly for active users plus after feedback, in the Python worker (ADR-0008). Stale feed served on failure.

### Q-P1-18 Why-this-matters notes: generation and cost (P1)
- Cite: §5E, REC-5 ("template polished by a small model, and are cached"), AI-2, AI-3, OPS-4.
- Suggested default: template per top signal type, filled per (item, signal); polished once by the small model and cached per (item, signal type, level); labeled "AI" in UI; stored in a separate table from source text with citations to the moment (AI-3).
- **Answer (owner, 2026-10-25):** Accepted as suggested. Model calls go through OpenRouter (ADR-0007).

### Q-P1-19 Which nav tabs ship in Phase 1 (P1)
- Cite: §4.1, Phase 1 "Not in Phase 1", C-06.
- Suggested default: Home and Library, plus Profile from the avatar for settings (Q-P1-36). Explore depends on Q-P1-42. See ADR-0006.
- **Answer (owner, 2026-10-25):** Home and Library tabs, Profile from the avatar (ADR-0006 C-06).

## Platform

### Q-P1-20 Event schema and naming (P0)
- Cite: DB-5, Phase 1 Week 1 ("event tracking"), Week 6 ("Athena queries split by beta group"), §8.
- Why it matters: events written in Week 1 must answer the "done when" metrics in Week 6. Renaming later breaks Athena queries.
- Blocks: P1-W1-S14.
- Suggested default: snake_case `object_action` names; envelope `{event_id (uuid, idempotency), name, version, occurred_at, user_id, is_guest, beta_group, session_id, props}`; JSON to Firehose, partitioned by date in S3. Phase 1 events: `session_started`, `onboarding_completed`, `feed_viewed`, `card_impression`, `card_opened`, `section_finished` (with `method`: return_prompt, plus mark_done only if ADR-0006 C-22 is confirmed), `article_finished`, `continue_clicked`, `item_saved`, `feedback_given` (with `kind`), `source_hidden`, `signup_completed`, `guest_merged`, `pwa_installed`, `outbound_click`.
- **Answer (owner, 2026-10-25):** Accepted as suggested. `section_finished.method` includes mark_done (C-22 confirmed).

### Q-P1-21 Definitions of the "done when" metrics (P0 for Week 1 event design)
- Cite: Phase 1 "Done when": "at least 40% of users return the week after signing up"; "at least half of opened items get marked finished".
- Why it matters: "return", "week after", "opened" and "marked finished" are not defined.
- Suggested default: return = any `session_started` in days 7–13 after `signup_completed`. Opened = `card_opened`. Finished = `section_finished` for a moment card or `article_finished` for a whole-article card, within 7 days of opening. Guests excluded from the return metric (they have not signed up).
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-22 Entitlements: minimal shape (P0)
- Cite: OPS-3 ("Features check capabilities, so plans can be added later through configuration"), Part IV item 1.
- Blocks: P1-W1-S15.
- Suggested default: a `plan` table (one row, `beta`) and a `plan_capability(plan, capability, limit)` table; every user has a plan; code calls `can(user, "feed.read")` or `limit(user, "ai.notes.daily")`. Capabilities are string constants in one TS module (and mirrored by generated types for Python, per ADR-0002). No billing.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-23 Cost budgets: minimal shape (P0)
- Cite: OPS-4 ("Per-user cost budgets and cost dashboards from Phase 1"), LOAD-6.
- Blocks: P1-W1-S16.
- Why it matters: Phase 1 AI spend is mostly per item (tagging, notes cached per item, AI-4), not per user. What a per-user budget caps is unclear.
- Suggested default: an `ai_usage` ledger row per model call (user_id nullable for offline jobs, feature, model, input/output tokens, cost_usd). Per-user daily budget checked before any user-triggered model call; offline jobs have a global daily budget. Over budget: skip the AI step and degrade (LOAD-5), emit a metric. Dashboard: a CloudWatch dashboard fed by metrics, plus an Athena query.
- **Answer (owner, 2026-10-25):** Shape accepted. The owner sets dollar limits before the beta.

### Q-P1-24 Beta groups and invite codes (P0)
- Cite: Phase 1 Week 1 ("invite codes for the two beta groups"), Week 6 ("about 30 students and 30 working developers"; "Athena queries split by beta group").
- Why it matters: is the product invite-only, and is a guest in a group?
- Blocks: P1-W1-S13.
- Suggested default: `invite_code(code, beta_group, max_uses, used_count, expires_at)`; groups `student` and `developer`. Invite code required at sign-up in the private beta; guests can use the app but are not in a group until they sign up with a code. Tension: a guest without a code can never sign up, so §5A's "Signing up keeps their saves and history" fails for them. Owner to decide whether guest access itself needs a code during the private beta. `beta_group` is on the user row and copied into every event.
- **Answer (owner, 2026-10-25):** An invite code is required for any access during the private beta, including guest mode. The code sets the group (student or developer).

### Q-P1-25 What counts as "lands on the right section" (P1)
- Cite: Phase 1 Week 6 ("a script that checks deep links land on the right section"), §3.2.
- Blocks: P1-W6-S02.
- Suggested default: run a headless browser on each moment's link. Heading anchor: the element with that id exists and its text matches the stored section title. Text fragment: the fragment's text is found on the page. Top of page: the stored section title text is found on the page. Report pass/fail per moment and per source; a source below a threshold (owner to set) gets its moments switched off by the owner.
- **Answer (owner, 2026-10-25):** Moments switched off for sources under a 90% pass rate.

### Q-P1-26 Local development emulation (P0)
- Cite: Phase 1 stack (RDS pgvector, S3, SQS, EventBridge, Firehose, managed auth).
- Blocks: P1-W1-S02.
- Suggested default: Docker Compose with Postgres + pgvector. S3, SQS: an emulator (LocalStack or MinIO + ElasticMQ, needs approval as dependencies) or interfaces with in-memory fakes in tests. EventBridge: run the scheduled job by CLI command locally. Firehose: write events to a local JSONL file behind the same interface. Cognito: a dev auth mode that issues local sessions only when `NODE_ENV=development`.
- **Answer (owner, 2026-10-25):** Docker Compose with Postgres + pgvector, MinIO (S3) and ElasticMQ (SQS). Firehose writes to a local JSONL file. EventBridge jobs run by CLI. Changed 2026-10-25 (owner): SeaweedFS replaces MinIO, because MinIO's Docker images are no longer published.

### Q-P1-27 LLM and embedding providers (P0 for Week 3)
- Cite: AI-2 ("Bedrock or Anthropic's API"), DB-3, AI-4, AI-5.
- Suggested default: Bedrock for tagging and notes (IAM auth, no extra secret). Embedding model and dimension chosen in Week 3 by a small eval on 50 moments (DB-3; this eval is new, AI-5 covers tagging, explanations and judge agreement only); the dimension is fixed in the schema, so changing it later means re-embedding.
- **Answer (owner, 2026-10-25):** OpenRouter for LLMs; Voyage AI for embeddings, model chosen by the Week 3 eval (ADR-0007).

### Q-P1-28 Environments, AWS account and region (P0)
- Cite: ARCH-4, Phase 1 Week 1.
- Suggested default: two environments (dev, prod) in two AWS accounts under one organization; one region; CDK bootstrapped by the owner.
- **Answer (owner, 2026-10-25):** One AWS environment: prod, in ap-south-1. Local is dev. Weeks 1–5 run locally (ADR-0005).

### Q-P1-29 Admin page access (P1)
- Cite: ING-6 ("an admin page for reviewing tags and section boundaries"), Phase 1 Week 3.
- Suggested default: a route in the Next.js app gated by a capability `admin.review` granted to the owner's account only (OPS-3).
- **Answer (owner, 2026-10-25):** The admin capability can be granted to the owner and invited reviewers.

### Q-P1-30 Rate limits (P2)
- Cite: LOAD-6.
- Suggested default: per-IP and per-user limits on write routes in the Next.js app, stored in Postgres (no Redis per CACHE-1). Values set by the owner.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-31 PWA scope (P2)
- Cite: Phase 1 Week 5 ("PWA install"); push is Phase 4 Week 24.
- Suggested default: manifest, icons, installability, an offline page. No offline reading (moments are links to publisher pages). No web push in Phase 1.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-32 Detecting the return from the publisher tab (P1)
- Cite: §5D ("On return, a prompt asks..."), C-22.
- Suggested default: `visibilitychange` to visible after a "Read on site" click shows the prompt for that moment, once.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-33 Email for auth and invites (P1)
- Cite: OPS-1 (SES), ADR-0004.
- Suggested default: Cognito sends auth email through SES in prod. SES production access and a sending domain are owner tasks.
- **Answer (owner, 2026-10-25):** Email + password with a reset flow, via Better Auth (ADR-0004). Auth email: local log in development, SES at beta.

### Q-P1-34 Data deletion and export (P2)
- Cite: C-28. Oct 23 is silent.
- Suggested default: account deletion by owner request in Phase 1; self-serve later.
- **Answer (owner, 2026-10-25):** Deletion on request, handled manually. Export later (ADR-0006 C-28).

### Q-P1-35 How a whole article gets marked finished (P0)
- Cite: §5D (return prompt is per section), Phase 1 "Done when" ("at least half of opened items get marked finished").
- Why it matters: the metric counts items, and whole-article cards (and sources with moments off) have no per-section prompt. No UI exists to finish them.
- Blocks: P1-W5-S02, P1-W5-S03, P1-W6-S04.
- Suggested default: the return prompt for a whole-article card asks "Finished this article?"; an article with moments is finished when all its moments are.
- **Answer (owner, 2026-10-25):** Both: the return prompt asks "Finished this article?", and a Mark done control exists. An article with moments finishes when all its moments do.

### Q-P1-36 Settings: editing choices and viewing or resetting inferred interests (P1)
- Cite: §5A ("users can view, edit, or reset anything inferred"), PER-1.
- Why it matters: Phase 1 creates an inferred layer (Q-P1-15) and Hide source, but no slice gives a place to view, reset or undo them.
- Suggested default: a minimal Profile page from the avatar: edit topics, level, break length; list hidden sources with undo; one "reset inferred interests" action. Add a Week 4 or 5 slice.
- **Answer (owner, 2026-10-25):** All four: edit topics/level/break length, hidden sources with undo, view inferred interests, reset inferred interests.

### Q-P1-37 Source quality score: who sets it and its scale (P1)
- Cite: ING-6 ("quality scores"), §5B ("quality signals"), Q-P1-13 (ranking uses it).
- Suggested default: the owner sets 1–5 per source in the seed list; no computed score in Phase 1.
- **Answer (owner, 2026-10-25):** Owner sets 1–5 in the seed file now; blended with computed signals later.

### Q-P1-38 Weekly link checks in Phase 1 (P2)
- Cite: ING-6 ("weekly link checks"), §5B. No Phase 1 week lists them.
- Suggested default: yes, as P1-W6-S03, because Week 6 beta depends on links working.
- **Answer (owner, 2026-10-25):** Accepted: ships in Phase 1 as P1-W6-S03.

### Q-P1-39 Time fit for metadata-only and excerpt items (P1)
- Cite: Q-P1-01, §3.2 (time budget), §5C ("Every card" fits or not, per the HTML).
- Why it matters: with no body text, reading time is unknown, so chips cannot size the item, and there is no embedding.
- Suggested default: use the feed's stated reading time if present; otherwise show the item only under the longest chip with "length unknown". Rank by metadata-only signals.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-40 Continue-card rules (P1)
- Cite: §3.2, §5C, Phase 1 Week 5.
- Suggested default: a continue card exists for an article with at least one finished moment and at least one unfinished; it points at the next unfinished moment in order; it expires after 30 days or when dismissed.
- **Answer (owner, 2026-10-25):** Accepted as suggested.

### Q-P1-41 When the "done when" metrics can be measured (P1)
- Cite: Phase 1 Week 6 (private beta starts), "Done when" (week-after return).
- Why it matters: the return metric needs at least two weeks after the beta opens, which is inside Phase 2.
- Suggested default: measure Phase 1 "done when" at the end of Week 8, while Phase 2 work proceeds.
- **Answer (owner, 2026-10-25):** Measured at the end of Week 8.

### Q-P1-42 Is search or Explore in Phase 1? (P1)
- Cite: §5J, DB-4, §4.1. Phase 1 "Not in Phase 1" does not list Explore or search, and no week schedules them.
- Suggested default: not in Phase 1; Explore tab hidden. Needs owner confirmation because the "Not in" list does not exclude it.
- **Answer (owner, 2026-10-25):** Not in Phase 1. Explore tab hidden.

## Index by priority

- P0: Q-P1-01, 02, 03, 06, 11, 13, 20, 21, 22, 23, 24, 26, 27, 28, 35
- P1: Q-P1-04, 05, 08, 10, 12, 14, 15, 16, 17, 18, 19, 25, 29, 32, 33, 36, 37, 39, 40, 41, 42
- P2: Q-P1-07, 09, 30, 31, 34, 38
