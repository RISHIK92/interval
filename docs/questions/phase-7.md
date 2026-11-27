# Phase 7 questions

Phase 7 (docs/roadmap/phase-7.md, the plan in docs/roadmap/phase-7-slices.md) is agent-waiting surfaces and growth. The plan was approved by the owner on 2026-11-20 (build from W46, week by week). Answers are recorded under each question; an unanswered one still carries only Claude's recommendation.

### Q-P7-01 Which agents get an installer (P0 for W46)

- Cite: §7; blueprint Part IV item 7 ("which agents expose usable start and finish events").
- Options:
  - **(a)** Claude Code only (it's already documented) plus `interval start`/`stop` for everything else;
  - **(b)** also the agent CLIs whose hook or notify config has documented start and finish events, each checked against its docs before its week;
  - **(c)** none: the extension and desktop app detect waits on their own.
- **Recommendation:** (b), limited to agents whose hooks are documented and stable. (c) would need to watch the editor or terminal, and that risks seeing code, which §7 forbids.

- **Answers (owner, 2026-11-20):** (b), all four agents whose hooks are documented: Claude Code (`UserPromptSubmit`/`Stop`), OpenAI Codex (`UserPromptSubmit`/`Stop`), Cursor (`beforeSubmitPrompt`/`stop`; beta, its gaps noted in docs/agent-hook.md) and Gemini CLI (`BeforeAgent`/`AfterAgent`). `interval hook install --agent <name>` writes the user-level config only (never a project's, which could be committed and turn the hook on for others), merged with what's there and kept as a backup; running it twice changes nothing; `interval hook uninstall --agent <name>` removes only Interval's entries.
- **Answer (owner, 2026-11-27), after checking the docs again:** Gemini CLI's docs say Antigravity CLI replaced it on 18 June 2026 for most users (paid-API and enterprise users keep it). Gemini stays, with that noted. Antigravity CLI gets no installer for now: it has no "prompt submitted" event, and its docs don't say whether a hook can block. Its users run `interval start`/`stop` by hand.

### Q-P7-02 Does the read API show the suggestions themselves (P0 for W46)

- Cite: §7 ("time-fitted suggestions and agent status"), CACHE-1.
- **Recommendation:** yes. It returns the top few items from the user's precomputed feed that fit the expected wait, each linking to the web app. The surfaces render links and never content, so the rights profile (ING-2) still applies only in the web app.

- **Answers (owner, 2026-11-20):** yes, links only: 3 suggestions, picked by the user's break length (the chip chosen at onboarding, or `?chip=` per request, as `/api/feed` does; PER-1), each a link into the web app. The CLI gets `interval status` from the same API.
- **Answers (owner, 2026-11-27):**
  - The API is gated by `agent.hook`, with no new capability.
  - A finished task shows as finished for 10 minutes, then idle.
  - Each suggestion links straight to its card, opened as Home opens it, and counted as an open from the companion (`card_opened` gains `via`).

### Q-P7-03 The extension's quick session: browser or webview (P0 for W47)

- **Recommendation:** browser. The session, its sign-in and its event tracking (DB-5) stay in one place. A webview would need a second auth path and its own content-security rules.

- **Answer (owner, 2026-11-20):** in the browser.

### Q-P7-04 The desktop technology (P0 for W48, needs an ADR)

- Cite: blueprint Part IV item 6; ARCH-2's languages (TS, Python, Go).
- **Options:** Electron (TS, larger app); Tauri (smaller, but adds Rust); a Go menubar app (no new language, but no shared UI with the web app).
- **Recommendation:** no recommendation until the ADR's measurements are in: the app size, memory at idle, and how much of the web UI each option reuses. The owner chose to decide later. If the date matters more than size, Electron is the default, since it stays in TS.

### Q-P7-05 Community questions (P0 for W50)

- Cite: §6.8.
- Questions for the owner:
  - Who may submit: any signed-in player, or only above a rating or reputation threshold?
  - Does a submission also pass the second-model check before moderation (OPS-4 cost)?
  - The reputation formula: approved submissions, player ratings and flags. Is it a starting number with a floor?
  - Where do community questions appear: quizzes only, battles, both, or neither until they're rated?
  - Credit: is the contributor's username shown?
- **Recommendation:**
  - any player with a verified email may submit, at most a few a day;
  - the existing second-model check runs first, then the owner's queue;
  - community questions appear in practice quizzes only (not rated battles, the daily challenge or tournaments) until enough ratings come in;
  - reputation rises with approved, well-rated questions and falls with removed ones.

### Q-P7-06 What "institutional features" means (P1)

- Cite: phase-7.md item 5. Nothing else in the docs defines it.
- **Recommendation:** the owner defines it (for example universities' or companies' cohorts, admin views or seat billing), then a PROPOSED ADR follows. There's no week until then.
