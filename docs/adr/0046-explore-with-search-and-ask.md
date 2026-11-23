# 0046. Explore: search, a gap card, spaces, "Saved most this week" and a grounded "Ask anything"

- Status: ACCEPTED (owner, 2026-11-23)
- Date: 2026-11-23
- Supersedes: none (schedules Explore, which ADR-0017 left disabled; answers C-28's Explore item)
- Superseded by: none

## Context

The owner's desktop design (`docs/wireframes/web-design.html`, screen "Explore, web", 2026-11-23) shows:

- an "Ask anything, or search your library" box with a microphone and "Ask";
- prompt chips: Compare two things, Explain like I'm new, Interview drill, Use my stack as the example;
- a "You asked · 'When should I shard?'" answer labelled AI, with source chips ("DDIA · ch. 6 Partitioning", "Postgres Weekly"), "Ask a follow-up" and "Make it a 4-min session";
- "A gap worth closing": "You know replication and caching. The idea that connects them is consistency models." with "Close the gap · 6 min";
- "Your spaces": #distributed, #databases, #system-design, #ai-infra, each with learners and "N new", and "Find more";
- "Saved most this week" with tabs Engineers / Spaces / New ("By backend engineers like you");
- "Bring your own reading" with "Add to Paths".

**Explore was never scheduled.** Q-P1-42 (owner, 2026-10-25): "Not in Phase 1. Explore tab hidden." ADR-0017 (ACCEPTED) shows it disabled: "Search is still not in Phase 1, so Explore is a promise." C-28: "Explore shows 'what's trending' in topic spaces (screen 04). Oct 23 does not address trending in Explore (§5C's 'not popularity' is about the feed), and schedules no Explore work in any phase." Today there is no search index; the only search ports are people and universities.

**What the product says.** §4: "Explore | Search across topics, authors, publications, and topic spaces". §5J: "Search covers metadata and permitted content by topic, author, publication, technology, and concept. Users can follow topic spaces and ask for explanations at a chosen level. Results always point back to original sources." §5C: the feed is ranked "not popularity".

**The owner's answers.** Q-WD-22 (2026-11-23): "build 'Ask anything' now as well as search, the gap card and spaces. That needs an ADR first." The owner also asked for "Saved most this week". Q-WD-03 (its popularity rules) has no recorded answer; its recommendation is used below, pending the owner.

**The rules Ask must meet:**

- **AI-1:** "No full summaries of third-party articles that could replace reading them."
- **AI-3:** "Every output cites its source passages and is stored separately from source text."
- **ING-2:** each source's rights profile (metadata only, excerpt, full text for internal processing, full text for display) "controls what the pipeline may do"; the database refuses body text a profile doesn't allow (`enforce_private_text_rights`).
- **OPS-4:** "Per-user cost budgets and cost dashboards." Today: the beta plan's `ai.budget.daily_cents` (50) and the global row in `ai_budget`, which stays at 30 cents a day locally.
- **AI-5:** "Evaluation sets … run on every prompt or model change."
- **ADR-0007, ADR-0008:** every model and embedding call goes through `workers/jobs/src/interval_jobs/ai/gateway.py`; TypeScript never imports a model SDK.
- **PER-1:** "explicit choices (always win)". Moments are deep links, never copies (Part I §3.2).

## Options

### A. All of it now, Ask grounded in retrieved moments (the owner's answer)

- Search, the gap card, spaces, "Saved most this week" and Ask, as below.
- Pros: the owner's answer; §5J's "ask for explanations at a chosen level"; every answer leads to moments.
- Cons: the first interactive, open-ended model feature; needs an eval, a budget gate and retention rules before launch.
- Cost to reverse: moderate. Ask is one route, one worker stage and two tables; switching off `explore.ask` hides it without a deploy.

### B. Explore now, Ask later (Claude's earlier recommendation in Q-WD-22)

- Pros: no new AI surface; the rest is deterministic.
- Cons: not what the owner chose; the page's lead feature missing.
- Cost to reverse: low.

### C. Ask as retrieval only (no generated text)

- The question is embedded and the best moments are listed, with no model answer.
- Pros: no AI-1 risk; costs one embedding.
- Cons: not the design's answer; "Compare two things" and "Explain like I'm new" need text.
- Cost to reverse: low. It is A's first step.

## Recommendation (not a decision)

**A**, the owner's answer, built in this order: search, spaces, the gap card, "Saved most this week", then Ask behind its eval.

**Search.** Postgres full text (a `tsvector` column with a GIN index; no new service, ADR-0011) over fields already shown on cards: item title, author, source name, moment titles, concept and technology names, and the stored excerpt (excerpt sources only, ≤ 300 characters). Plus the user's own saves and note bodies. Never `content_item_private_text`: full text for internal processing stays internal (ING-2), so metadata_only and full-text sources are found by their metadata alone. Hidden sources, broken links (`link_broken_at`) and sources switched off are left out. Results open the moment's deep link or the item's reader.

**Spaces.** A space is one of the 4 topics. Followed spaces are the user's onboarding topics; follow and unfollow on Explore edit that same explicit choice (PER-1), so the feed follows it. A learner count shows only above 50 (Q-WD-22); "N new" counts items added this week in that topic that the user hasn't opened. "Find more" lists the 4 topics. No new topics without the sources behind them (Q-WD-23).

**A gap worth closing.** Deterministic, no AI: a concept the user hasn't mastered with concept edges to two mastered concepts, the one with the shortest moment first. "Close the gap · N min" opens that moment. Dismissing it is stored per user and concept and never shown again.

**Saved most this week (Q-WD-03's recommendation, pending the owner).** It's a browse list, not the feed, so §5C's "not popularity" doesn't apply (C-28). An item appears only once at least 5 distinct users saved it in the last 7 days; items the user read or hid are left out; the heading always says "Saved most this week". Tabs: Everyone (the design's "Engineers · By backend engineers like you" needs a role nobody has yet, Q-WD-26), Spaces (the user's followed topics), New (items published in the last 7 days).

**Ask anything.**

- **Flow:** the web route (`POST /api/explore/ask`, zod-validated, question at most 300 characters, an idempotency key from the browser, LOAD-5) checks `explore.ask`, the user's daily count and budget, stores the question and queues an `ask` job. The Python worker answers; the page polls, as HLD feedback does (P6-W41). TypeScript calls no model.
- **Retrieval (worker):** the question is embedded through the gateway; pgvector finds the nearest moments (`moment_embedding`) and concepts, minus hidden sources, broken links and switched-off sources. What the model may read per candidate, by rights profile:
  - **metadata_only:** title, source, author and concept names only;
  - **excerpt:** those, plus the stored excerpt;
  - **full_text_internal / full_text_display:** those, plus the moment's section text from `content_item_private_text`, read inside the worker only;
  - approved concept explainer scripts (original content, AI-1).
    The user's private books are out, until Q-WD-20's own ADR.
- **Answer rules (validated before storing, AI-1, AI-3):** at most 120 words; every sentence cites at least one passage ID from the retrieved set, and any other citation fails the answer; no verbatim run of more than 25 words from any source text, and none at all from full_text_internal text; it ends by pointing to the cited moments. Retrieved text is data, never instructions (the judge's injection hardening). When nothing relevant is retrieved, no model is called: "Nothing in your library covers this yet", with search results.
- **Levels and chips:** the chips only prefill the box with a template ("Explain like I'm new: …" sets the level, §5J). "Use my stack" adds the user's technology names (PER-4, ADR-0024: names, never code). "Interview drill" answers with three practice questions, each citing a moment.
- **Model:** the question-generation model class within the owner's $0.80/M rule, behind its own `ASK_MODEL` switch (as ADR-0038 did), feature `ask` in `ai_usage`.
- **Storage (AI-3):** `ask_question` (user, text, idempotency key, asked at, follow-up of) and `ask_answer` (question, text, citations as moment IDs with passage locators, model, prompt version, cost), apart from all source text.
- **UI:** an "AI" label on every answer; source chips are the cited moments' deep links. "Ask a follow-up" sends the previous question and answer with the new one, up to 3 follow-ups a thread. "Make it a 4-min session" needs no model: the cited moments in concept-prerequisite order, cut to fit the user's current chip (the shortest one alone when none fit), opened as a session; the label shows the real total.
- **Budget (OPS-4):** each Ask is refused, with a plain message, when the user's `ai.budget.daily_cents` is spent, the global daily cap is spent (30 cents locally, ADR-0038), or the user has asked `explore.ask.daily` times today (20 for the beta plan). Refusals are logged and counted (a metric), not silent.
- **Retention:** questions and answers are kept 30 days, then deleted; the user can delete any one now. Question text never enters events, ranking or inferred interests.
- **Eval (AI-5), before launch:** `workers/jobs/evals/ask.yaml` with at least 30 questions over the local catalogue, including metadata_only, excerpt and full-text cases and questions nothing covers. It checks citations within the retrieved set, the rights rules above (100% required), the 25-word rule, the word limit and the no-answer case; launch at 90% or more overall. It runs on every prompt or model change.
- **No voice:** the microphone is left out (Q-WD-22's recommendation).

What would change it: owner answers to Q-WD-03 (popularity) or the open questions below; an eval that can't reach the bar (then ship C first).

## Consequences

- **Navigation:** Explore is enabled on the web sidebar and the phone tab bar (amending ADR-0017's "disabled" for Explore); phones get one column. Q-WD-25's Clear state links to Explore.
- **DB (ADR-0002):** the search vectors and index; `explore_gap_dismissal`; `ask_question`, `ask_answer`; the `ask` AI feature; capabilities `explore.ask` and `explore.ask.daily` for the beta plan; a 30-day purge.
- **Worker:** the `ask` stage (retrieval, gateway call, validator), its eval and in-memory fakes (ADR-0012); the purge on an existing daily timer.
- **Web:** the Explore page, the search, follow and ask routes (capabilities checked there, ADR-0036).
- **Events (DB-5):** `explore_searched` (result count, no query text), `space_followed` / `space_unfollowed`, `gap_opened` / `gap_dismissed`, `ask_submitted` (length, chip, follow-up or not), `ask_answered` (citation count, cost, or refusal reason), `ask_session_started`. `events.json` and codegen change.
- **Docs:** C-28's Explore item is settled by this ADR; docs/conflicts.md notes it.

## Open questions

- Q-WD-03: confirm the popularity rules (5 distinct savers, read or hidden left out, the label), and whether "Engineers" waits for a role or becomes "Everyone".
- Retention: 30 days, or as long as the account?
- Does the global daily cap apply to Ask (a user-initiated call), or only the per-user budget? Recommended: both.
- May Ask read the user's own notes as context, or only the catalogue?
- Is 20 questions a day the right beta limit, and 120 words the right answer length?
- Is the voice input wanted later?
