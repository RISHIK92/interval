# Phase 1 slices

Phase 1 (docs/roadmap/phase-1.md) as one-session slices. Each slice has one concern, can be tested on its own, and can be reviewed in under 30 minutes. Run a slice with `/slice <ID>`.

Ordering rules:
- No slice starts before the ADRs it needs are ACCEPTED.
- Slices P1-W1-S04 to S06 are a walking skeleton: one source, one moment, one feed card, end to end. They pull thin versions of Week 2–4 work forward. Later slices replace the thin parts.
- Week 1 run order differs from ID order: S13 (invite codes) runs before S10 (guest sessions), because guest access needs a code (Q-P1-24).
- Week numbers follow the roadmap. Week 1 has 16 slices and will not fit in five days at this size; the skeleton slices are the reason. Expect Week 1 work to run into Week 2.

Field key: **IDs** = decision IDs implemented. **Needs** = slices and ADRs that must be done or ACCEPTED first. **Q** = open questions in docs/questions/phase-1.md.

## Week 1: platform, walking skeleton, accounts, scaffolding

### P1-W1-S01 Workspace and tooling baseline
- IDs: ARCH-2, ARCH-3 (pnpm + Turborepo from day 1, ADR-0003), ARCH-4 (TS)
- Needs: ADR-0003 (ACCEPTED), docs/proposals/phase-1-skeleton.md (ACCEPTED 2026-10-25)
- First step: install uv locally (`brew install uv`, owner-approved 2026-10-25), so the hooks run Python checks.
- Goal: `pnpm install` and `uv sync` succeed, and one Turborepo command runs format check, lint, typecheck and tests across the empty TS packages and the Python worker.
- Acceptance: a trivial test passes in each of `apps/web`, `infra`, `packages/db`, `workers/jobs`. A deliberate type error in each fails the typecheck command. The two hook scripts run the real tools on an edited file. CLAUDE.md `## Commands` (filled in 2026-10-25) matches the commands that actually run.
- Out of scope: any app code, Next.js pages, CDK constructs, Docker.
- Q: none.

### P1-W1-S02 Local Postgres, migrations and generated types
- IDs: DB-1, DB-3 (pgvector extension), ADR-0002
- Needs: S01, ADR-0002
- Goal: one command starts Postgres with pgvector, MinIO and ElasticMQ locally (Q-P1-26), applies migrations, and regenerates TS and Python types; CI-style check fails if generated files are stale.
- Acceptance: migration 0001 enables `vector` and creates a `schema_meta` table. Generated TS and Python modules exist and are committed. Editing a migration without regenerating fails the check script. Tests in TS and Python connect and read `schema_meta`.
- Out of scope: domain tables, AWS.
- Q: Q-P1-26.

### P1-W1-S03 Next.js shell
- IDs: ARCH-1, LOAD-1, OPS-2 (structured logs)
- Needs: S01
- Goal: the web app serves a home page and `GET /api/health` (checks DB), runs from a standalone container image, and refuses to start with missing env vars.
- Acceptance: health route test (DB up → 200, DB down → 503). Env validation test. `docker build` produces an image that serves `/api/health` locally. Logs are JSON lines.
- Out of scope: auth, navigation beyond a placeholder, styling system.
- Q: Q-P1-19.

### P1-W1-S04 Skeleton: ingest one source
- IDs: ING-1 (fetch, store), ING-2 (profile column, gate on store)
- Needs: S02
- Goal: a worker command fetches one configured RSS feed and stores its newest item's metadata, and stores extracted text only if the source's rights profile allows internal full text.
- Acceptance: tests with a recorded feed fixture. A metadata-only source stores no body text. A full-text-internal source stores extracted text in a private table. Running twice stores one item.
- Out of scope: scheduling, SQS, robots.txt, dedupe, multiple sources.
- Q: Q-P1-01, Q-P1-02.

### P1-W1-S05 Skeleton: one item into moments
- IDs: ING-4, §3.2
- Needs: S04
- Goal: a stored full-text item splits into moments at headings, each with a deep link (heading anchor, else text fragment, else top of page).
- Acceptance: fixture articles: with ids on headings, without ids, with no headings (no moments). Each moment stores title, order, estimated minutes, link, link type. Moments are never created for a source with moments switched off or without internal full-text rights.
- Out of scope: 2–8 minute merge/split rules (P1-W3-S03), embeddings, tagging.
- Q: Q-P1-06.

### P1-W1-S06 Skeleton: feed shows one moment card
- IDs: §3.2, §5C (card only), CACHE-1 (read path only)
- Needs: S03, S05
- Goal: the home page lists stored moments as cards ("Section 2 of 4 · 3 min") linking to the publisher's page at the section.
- Acceptance: page test renders cards from seeded rows with correct link and attribution. No source text is rendered beyond the section title. The vertical path works locally end to end.
- Out of scope: ranking, guests, time chips, notes.
- Q: none.

### P1-W1-S07 CI pipeline
- IDs: ARCH-4 (synth), Phase 1 Week 1 "CI/CD"
- Needs: S01, S02, ADR-0009; a GitHub remote (owner)
- Goal: every PR runs format check, lint, typecheck, tests, the migration/codegen check, and `cdk synth`.
- Acceptance: a PR with a lint error fails; a clean PR passes. CI runs Postgres with pgvector as a service.
- Out of scope: deploy jobs (the owner deploys).
- Q: Q-P1-28.

### P1-W1-S08 CDK: environments, network, data
- IDs: ARCH-4, DB-1, DB-3, DB-6, OPS-1 (Secrets Manager)
- Needs: S01
- Goal: `cdk synth` produces a prod stack in ap-south-1 (Q-P1-28) for VPC, RDS Postgres (pgvector-capable version) with generated credentials in Secrets Manager, and private encrypted S3 buckets.
- Acceptance: CDK assertion tests: RDS not public, storage encrypted, S3 blocks public access and enforces TLS, secrets not in plain env vars. Synth only; no deploy until the beta (ADR-0005).
- Out of scope: app services.
- Q: Q-P1-28.

### P1-W1-S09 CDK: web service and worker queue
- IDs: LOAD-1, LOAD-3, ING-3, CACHE-4, ADR-0005
- Needs: S08, S03, ADR-0005 (host still PROPOSED; this slice waits for it)
- Goal: `cdk synth` adds ECR, the Fargate web service behind an ALB and CloudFront, the worker service, SQS queues with DLQs, and an EventBridge Scheduler schedule.
- Acceptance: assertion tests: tasks in private subnets, DB reachable only from web and worker security groups, every queue has a DLQ, CloudFront caches `/_next/static/*`.
- Out of scope: Firehose (S14), alarms (W6-S05).
- Q: none.

### P1-W1-S10 Guest sessions
- IDs: §5A (guest-first), ADR-0004
- Needs: S02, S03, S13, ADR-0004
- Goal: a first visit with a valid invite code creates a guest user (Better Auth anonymous user) and a session cookie; later requests resolve the same user.
- Acceptance: tests: visitor without a code is refused (Q-P1-24); with a code gets a session and a guest user in the code's beta group; tampered cookie rejected; 30-day sliding expiry and cleanup of inactive guests (Q-P1-12).
- Out of scope: sign-up, merge, onboarding UI.
- Q: Q-P1-12.

### P1-W1-S11 Accounts with Better Auth
- IDs: OPS-1 (as overridden by ADR-0004), ADR-0004
- Needs: S10, ADR-0004
- Goal: a guest can sign up and sign in with email and password, and the session resolves to an account user.
- Acceptance: tests: sign-up, sign-in, wrong password, password reset through the local email log; sign-out clears the session; passwords never logged.
- Out of scope: merge (S12), invite codes (S13), GitHub.
- Q: Q-P1-33.

### P1-W1-S12 Guest-to-account merge
- IDs: §5A, PER-1, LOAD-5 (idempotent)
- Needs: S11
- Goal: signing up keeps the guest's saves, history and choices according to the merge rules.
- Acceptance: one test per rule in Q-P1-11 (new account, existing account, overlapping saves, conflicting explicit choices). Running the merge twice changes nothing. Emits `guest_merged` once.
- Out of scope: data export/delete.
- Q: Q-P1-11.

### P1-W1-S13 Invite codes and beta groups
- IDs: Phase 1 Week 1 "invite codes for the two beta groups"
- Needs: S02, S03
- Goal: any access during the private beta (guest or sign-up) requires a valid invite code, and the code assigns the user to `student` or `developer`.
- Acceptance: tests: valid code, used-up code, expired code, unknown code. A CLI command issues codes for a group. `beta_group` is stored on the user.
- Out of scope: admin UI for codes.
- Q: Q-P1-24.

### P1-W1-S14 Event tracking
- IDs: DB-5, LOAD-5 (idempotency key)
- Needs: S10, S09
- Goal: the web app and worker emit typed events through one interface to Firehose in AWS and to a local file in development.
- Acceptance: tests: every event matches the envelope schema; `event_id` is unique per emission; emission failure is logged and counted, never thrown into the request. CDK assertion test for the Firehose stream to S3. Event names come from one list.
- Out of scope: Athena queries (W6-S04).
- Q: Q-P1-20, Q-P1-21.

### P1-W1-S15 Entitlements layer
- IDs: OPS-3
- Needs: S10
- Goal: every user has a plan, and code checks capabilities and limits through one function.
- Acceptance: tests: `beta` plan grants `feed.read`; unknown capability is a type error; limits read from the plan. The admin capability exists for Q-P1-29.
- Out of scope: billing, plan UI.
- Q: Q-P1-22.

### P1-W1-S16 Cost budgets
- IDs: OPS-4, LOAD-6, LOAD-5
- Needs: S15, S14
- Goal: every model call goes through `ai/gateway.py` in the Python worker (ADR-0008), which calls OpenRouter or Voyage (ADR-0007), records cost and refuses calls over the user or global daily budget.
- Acceptance: tests with a fake model client: usage row written per call; call over budget is skipped and the caller gets an explicit "over budget" result; a metric is emitted.
- Out of scope: dashboards (W6-S05), real model calls.
- Q: Q-P1-23.

## Week 2: ingestion

### P1-W2-S01 Sources and seed list
- IDs: ING-2, ING-6, §5B, §3.2 (moments switch)
- Needs: W1-S04
- Goal: the worker loads the seed list file into a `sources` table with rights profile, moments switch, paywall flag and quality score.
- Acceptance: tests: invalid profile rejected with a line number; reload is idempotent; removing a source from the file disables it rather than deleting it.
- Out of scope: the full 50–100 list content (owner data).
- Q: Q-P1-01, Q-P1-02, Q-P1-09, Q-P1-37.

### P1-W2-S02 Staged pipeline on SQS
- IDs: ING-1, LOAD-3, LOAD-5
- Needs: W1-S09, W2-S01
- Goal: ingestion runs as stages chained by SQS messages, each stage retryable and idempotent, with failures landing in a DLQ.
- Acceptance: tests with an in-memory queue: a stage that fails three times goes to the DLQ; re-delivering a message does not duplicate rows; every stage checks the rights profile before running.
- Out of scope: real stage logic beyond pass-through.
- Q: none.

### P1-W2-S03 Adaptive polling schedule
- IDs: ING-3
- Needs: W2-S02, ADR-0006 (C-18)
- Goal: each source is polled at an interval that adapts to its publishing rate.
- Acceptance: tests on the interval function (bounds, backoff on no new items, speed-up on frequent posts). EventBridge Scheduler triggers one "due sources" job.
- Out of scope: WebSub (Q-P1-07).
- Q: Q-P1-07.

### P1-W2-S04 Polite fetcher
- IDs: ING-1 (robots.txt, per-domain rate limits, conditional requests)
- Needs: W2-S02
- Goal: all fetches respect robots.txt, a per-domain rate limit, and use ETag / Last-Modified.
- Acceptance: tests with a local HTTP server: disallowed path not fetched; 304 handled; two fetches to one domain are spaced; user agent identifies Interval.
- Out of scope: JS rendering.
- Q: none.

### P1-W2-S05 Heading-preserving extraction
- IDs: ING-1 (extract keeping headings), ING-2
- Needs: W2-S04
- Goal: extraction produces the article's sections with heading text, level and the original heading id when present.
- Acceptance: fixtures from at least five real seed sources (stored as test files): heading tree and ids match. Sources without internal full-text rights skip extraction.
- Out of scope: segmentation.
- Q: Q-P1-01.

### P1-W2-S06 Canonical URLs and duplicate detection
- IDs: ING-1 (normalize)
- Needs: W2-S05
- Goal: items are keyed by canonical URL, and near-duplicates across sources link to one primary item.
- Acceptance: tests: tracking params stripped; cross-site canonical ignored; near-duplicate pair detected; metadata-only sources dedupe on metadata.
- Out of scope: merging duplicate items' concept tags.
- Q: Q-P1-08.

## Week 3: concepts, tagging, moments

### P1-W3-S01 Concept graph
- IDs: DB-2, §3.1
- Needs: W1-S02
- Goal: concepts and typed edges load from an owner-approved seed file, and recursive queries return prerequisites.
- Acceptance: tests: only the three edge types are accepted; cycles in "prerequisite of" are rejected; a retired concept keeps its tags readable; recursive prerequisite query returns the expected set. A script drafts candidate concepts for owner review (output file only).
- Out of scope: the concept list itself (owner data).
- Q: Q-P1-03, Q-P1-04.

### P1-W3-S02 Concept tagging and difficulty
- IDs: AI-2, AI-3, AI-4, AI-5, OPS-4
- Needs: W3-S01, W1-S16, W2-S05
- Goal: each item and moment gets concept tags and a difficulty estimate (three levels, Q-P1-10) from the small OpenRouter model (ADR-0007), once per item, through the cost-budget wrapper.
- Acceptance: eval set of ~30 owner-labeled moments with a pass threshold; tags outside the concept list are rejected; re-running does not re-call the model; tags are stored separately from source text with the model and prompt version.
- Out of scope: question generation.
- Q: Q-P1-10, Q-P1-27.

### P1-W3-S03 Moment segmentation rules
- IDs: ING-4, §3.2
- Needs: W1-S05, W2-S05
- Goal: segmentation applies the 2–8 minute rule and the edge-case rules.
- Acceptance: one test per rule in Q-P1-06 (short merge, long split, no headings, code blocks, oversized flag).
- Out of scope: admin overrides (W3-S05).
- Q: Q-P1-06.

### P1-W3-S04 Embeddings per moment
- IDs: DB-3, AI-4, OPS-4
- Needs: W3-S03, W1-S16
- Goal: every moment of a full-text-internal source has an embedding, and similarity queries can filter by rights, source and difficulty in one query.
- Acceptance: Voyage model picked by an eval on ~50 owner-labeled moments (ADR-0007); tests with a fake embedder; query test with filters; no embedding for sources without internal full-text rights.
- Out of scope: search UI (DB-4).
- Q: Q-P1-27.

### P1-W3-S05 Admin review page
- IDs: ING-6
- Needs: W3-S02, W3-S03, W1-S15
- Goal: the owner can review and correct concept tags and section boundaries for an item.
- Acceptance: page gated by the admin capability; edits are stored as overrides that survive re-ingestion; non-admins get 404.
- Out of scope: bulk tools.
- Q: Q-P1-29.

### P1-W3-S06 Per-source switches in admin
- IDs: §3.2 (moments off switch), ING-2, ADR-0006 (C-28)
- Needs: W3-S05
- Goal: an admin can switch moments off for a source, which falls back to whole articles. Disabling a source happens in the seed file, not here (ADR-0006 C-28).
- Acceptance: tests: switching moments off hides that source's moments from the feed on next refresh and survives a seed reload.
- Out of scope: rights profile editing in UI (the seed file is the owner of profiles).
- Q: Q-P1-01.

## Week 4: onboarding, ranking, notes, feedback

### P1-W4-S01 Guest-first onboarding
- IDs: §5A, PER-1 (explicit layer), PER-3
- Needs: W1-S10, ADR-0006 (C-21)
- Goal: a new guest picks topics, level and break length and sees a feed immediately.
- Acceptance: tests: choices stored as explicit preferences; skipping is not possible without a topic; returning guest skips onboarding; `onboarding_completed` emitted.
- Out of scope: GitHub step, Play step, format preferences.
- Q: Q-P1-10, Q-P1-16.

### P1-W4-S02 Candidate generation
- IDs: REC-1
- Needs: W3-S02, W3-S04, W4-S01
- Goal: in the Python worker (ADR-0008), produce candidates for a user from topic match, embedding similarity and continue items.
- Acceptance: tests per generator with fixture data; hidden sources and Not interested items never appear.
- Out of scope: scoring.
- Q: Q-P1-13, Q-P1-14.

### P1-W4-S03 Rule-based scoring and re-ranking
- IDs: REC-2, REC-3
- Needs: W4-S02
- Goal: candidates get a score from owner-approved rules and are re-ranked with a per-source cap and MMR.
- Acceptance: tests: each rule moves the score in the expected direction; per-source cap holds; diversity test on a fixture set; weights come from one config.
- Out of scope: Thompson sampling (W4-S09), learned model.
- Q: Q-P1-13.

### P1-W4-S04 Precomputed feed and fallback
- IDs: CACHE-1, LOAD-5
- Needs: W4-S03
- Goal: each user's ranked feed is stored in Postgres and served from there; if recompute fails, the last feed is served and the failure is counted.
- Acceptance: tests: recompute after feedback; stale feed served on ranking error with a metric; feed read does one query.
- Out of scope: Redis (CACHE-1 forbids).
- Q: Q-P1-17.

### P1-W4-S05 Time chips and format selection
- IDs: §3.2, §4.1
- Needs: W4-S04, ADR-0006 (C-23)
- Goal: the selected time chip decides whether the feed shows moments or whole articles, and cards say whether they fit.
- Acceptance: tests per chip: 1–3 and 3–8 show moments, 8–15 shows whole articles that fit plus long moments (Q-P1-16); continue cards always shown; chip persists per session; items with unknown length appear only under 8–15 with "length unknown" (Q-P1-39).
- Out of scope: filters (ADR-0006 C-20).
- Q: Q-P1-16.

### P1-W4-S06 Why-this-matters notes
- IDs: §5E, REC-5, AI-1, AI-2, AI-3, AI-4, OPS-4
- Needs: W4-S03, W1-S16
- Goal: each card shows a short labeled note built from its top ranking signal, cached per item and signal.
- Acceptance: tests: note never contains source text beyond the title; stored separately with citation to the moment; labeled AI in UI; cache hit skips the model; over budget shows a template-only note.
- Out of scope: project context (Phase 2).
- Q: Q-P1-18.

### P1-W4-S07 Feedback controls
- IDs: §5C, PER-1
- Needs: W4-S04, ADR-0006 (C-20)
- Goal: More like this, Less like this, Not interested (hides the item and down-ranks its concepts), Save and Hide source change the feed as defined in Q-P1-15, and never change explicit choices.
- Acceptance: one test per control; explicit topic choices unchanged after any control; events emitted.
- Out of scope: follow/mute/prioritize sources (ADR-0006 C-19).
- Q: Q-P1-15.

### P1-W4-S08 Profile settings and inferred reset
- IDs: §5A ("view, edit, or reset anything inferred"), PER-1
- Needs: W4-S07, ADR-0006 (C-06)
- Goal: from the avatar, a user edits topics, level and break length, undoes hidden sources, views inferred interests, and resets them.
- Acceptance: tests: edits update explicit choices only; reset clears the inferred layer and leaves explicit choices; undo hide restores the source on next recompute.
- Out of scope: GitHub, privacy switches for later phases, data export.
- Q: Q-P1-36.

### P1-W4-S09 Thompson sampling for exploration
- IDs: REC-4, REC-3 (novelty slots)
- Needs: W4-S03
- Goal: a small share of feed slots explores adjacent topics and new sources, chosen by Thompson sampling on finish rates.
- Acceptance: tests with a fixed seed: exploration share stays within the configured bound; arms with more finishes are chosen more often over many draws; explicit exclusions are never sampled.
- Out of scope: learned ranking model.
- Q: Q-P1-13.

## Week 5: reading loop

### P1-W5-S01 Read on site
- IDs: §3.2, §5D, §8 (publisher value)
- Needs: W4-S05
- Goal: "Read on site" opens the publisher page at the moment's section in a new tab and records an attributed outbound click.
- Acceptance: tests: link per link type; `outbound_click` and `card_opened` emitted; "Open original website" always present.
- Out of scope: native WebView.
- Q: none.

### P1-W5-S02 Return prompt and Mark section done
- IDs: §5D, ADR-0006 (C-22)
- Needs: W5-S01
- Goal: on returning to the tab, the user is asked "Finished this section? Continue to the next?" (or "Finished this article?" for a whole-article card), and can also mark the section or article done from the context panel (ADR-0006 C-22, Q-P1-35).
- Acceptance: tests: prompt appears once per open; yes records `section_finished` or `article_finished` and offers the next moment; no records nothing; Mark done records the same events with `method = mark_done`.
- Out of scope: automatic progress detection (native only).
- Q: Q-P1-32, Q-P1-35.

### P1-W5-S03 Progress and continue cards
- IDs: §3.2, §5C
- Needs: W5-S02
- Goal: moment progress is tracked per user, half-read articles produce continue cards, and finishing every moment marks the article finished.
- Acceptance: tests: continue card points at the next unfinished moment; `article_finished` emitted once.
- Out of scope: mastery (Phase 2).
- Q: Q-P1-05, Q-P1-35, Q-P1-40.

### P1-W5-S04 Saves and history
- IDs: §5I
- Needs: W5-S01
- Goal: users can save items, and opened items appear in history; both keep URL and attribution only.
- Acceptance: tests: save is idempotent; unsave works; no body text stored; guest saves survive merge (W1-S12).
- Out of scope: notes, highlights, collections.
- Q: none.

### P1-W5-S05 Library tab
- IDs: §4.1, §5I, ADR-0006 (C-06)
- Needs: W5-S04
- Goal: the Library tab lists saves and history.
- Acceptance: page tests for empty and populated states.
- Out of scope: review queue, knowledge map, audio queue.
- Q: Q-P1-19.

### P1-W5-S06 PWA install
- IDs: §4.2 (PWA primary), Phase 1 Week 5
- Needs: W1-S03
- Goal: the web app is installable on phone and desktop browsers.
- Acceptance: manifest and service worker pass a Lighthouse installability check; `pwa_installed` emitted.
- Out of scope: offline reading, web push.
- Q: Q-P1-31.

## Week 6: tuning, verification, beta

### P1-W6-S01 Ranking inspection for tuning
- IDs: REC-2
- Needs: W4-S03, W1-S15
- Goal: the owner can see, for their own feed, each card's score broken down by rule, and change weights in config.
- Acceptance: admin-only page test; weight change reflected after recompute.
- Out of scope: automatic tuning.
- Q: Q-P1-13.

### P1-W6-S02 Deep-link verification script
- IDs: §3.2, ING-4, Phase 1 Week 6
- Needs: W3-S03
- Goal: a script opens every moment link in a headless browser and reports whether it lands on the right section, per moment and per source, flagging sources under a 90% pass rate (Q-P1-25).
- Acceptance: tests against local fixture pages for each link type, pass and fail.
- Out of scope: automatic switching of moments off.
- Q: Q-P1-25.

### P1-W6-S03 Weekly link health checks
- IDs: ING-6, §5B
- Needs: W2-S04
- Goal: a weekly job checks item URLs and marks broken links so they leave the feed.
- Acceptance: tests: 404 and 410 marked broken; transient 5xx retried; job is idempotent.
- Out of scope: replacement link search.
- Q: Q-P1-38.

### P1-W6-S04 Athena queries by beta group
- IDs: DB-5, Phase 1 "Done when"
- Needs: W1-S14, W1-S13
- Goal: saved Athena queries report the two "done when" metrics, split by beta group.
- Acceptance: queries run on a fixture event set in a local engine (DuckDB or similar, needs approval) and give the expected numbers.
- Out of scope: dashboards.
- Q: Q-P1-21, Q-P1-35, Q-P1-41.

### P1-W6-S05 Dashboards and alarms
- IDs: OPS-2, OPS-4
- Needs: W1-S16, W1-S09
- Goal: CloudWatch dashboards show AI cost per day and per user, feed latency, ingestion failures and DLQ depth, with alarms on DLQ messages, 5xx rate and budget breaches.
- Acceptance: CDK assertion tests for dashboards and alarms.
- Out of scope: paging integrations.
- Q: none.

## Slice count

| Week | Slices |
|---|---|
| 1 | 16 |
| 2 | 6 |
| 3 | 6 |
| 4 | 9 |
| 5 | 6 |
| 6 | 5 |
| Total | 48 |

## Phase 1 "done when" metrics

From docs/roadmap/phase-1.md:

| Metric | Slices that make it measurable |
|---|---|
| "at least 40% of users return the week after signing up" | W1-S11 (sign-up), W1-S13 (beta group), W1-S14 (`signup_completed`, `session_started`), W6-S04 (query) |
| "at least half of opened items get marked finished" | W1-S14 (events), W5-S01 (`card_opened`), W5-S02 (`section_finished`), W5-S03 (`article_finished`), W6-S04 (query) |

Both definitions depend on Q-P1-21. The finish metric also depends on Q-P1-35. The return metric cannot be measured until about two weeks after the beta opens (Q-P1-41).
