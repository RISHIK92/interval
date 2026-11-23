# Phase 7 slices

Approved by the owner on 2026-11-20 (build from W46, week by week).

Phase 7 (docs/roadmap/phase-7.md) is agent-waiting surfaces and growth, from week 46. As in Phases 5 and 6, each roadmap week is one unit: its questions are asked once at the start (docs/questions/phase-7.md), it gets one review, and it is one commit. The field key is the same as in Phase 5.

The source has no Part II decision IDs for this phase. Its scope is product.md §7 (the hook CLI, the desktop companion, the VS Code extension), §6.8 ("Community-submitted (later): moderated, rated by players, and weighted by contributor reputation"), and the blueprint's Part IV open decisions 6 (Electron or Tauri) and 7 (which agents expose usable start and finish events). "Institutional features" is defined nowhere in the docs, so it has no week here until the owner defines it (Q-P7-06).

Already in place, and reused:

- **The hook CLI** (`cli/interval`, Go, Phase 3):
  - `interval login <token>`, `start` and `stop`;
  - device tokens (`ivd_…`, stored only as a hash);
  - `/api/agent/started` and `/api/agent/finished`, which accept nothing but an idempotency key (§7, C-09);
  - the 45-second nudge.
- **Time-fitted suggestions:** the precomputed feed (CACHE-1) and quick sessions.
- **The question bank:** AI-generated questions with second-model validation and the owner's spot checks (§6.8), and hand-written questions.
- **Capabilities** (ADR-0036): every new surface is gated the same way as `agent.hook`.

Order: the shared read API comes first, so the extension and the desktop app consume one API instead of each building its own (ARCH-2, "nothing implemented twice"). Then the extension, which carries no technology decision. The desktop app waits for its ADR. Community questions come last, because they need the most product answers.

## Week 46: agent status and suggestions for companion surfaces; more agent integrations

- IDs: §7; Part IV item 7; Q: Q-P7-01, Q-P7-02.
- Goal:
  - a read-only API for a signed-in device: the current agent task's status (started, running for N seconds, finished) and suggestions fitted to the time it's likely to take. It is authenticated by the same device token as the hook (no new credential), so the extension and the desktop app share it;
  - `interval hook install --agent <name>` writes the hook config for each agent the owner picks in Q-P7-01. It covers only agents with documented start and finish events; every other agent keeps `interval start`/`stop`;
  - tests: the API never returns anything a hook didn't send (no prompts or code exist to return), and it applies the capability gate and rate limit; one golden config file per installer.
- Out of scope: any agent integration that needs to read the agent's output.

## Week 47: the VS Code extension (also Cursor)

- IDs: §7; Q: Q-P7-03.
- Goal:
  - `apps/vscode` (TS): sign in with a device token (the same flow as `interval login`);
  - a status-bar item showing the agent's status from Week 46's API;
  - a command that opens a time-fitted quick session in the browser (or in a webview, per Q-P7-03);
  - a VSIX build, run locally under the extension test host.
- Publishing to the VS Code Marketplace and Open VSX is the owner's (ADR-0013: nothing ships until all phases are built).

## Weeks 48–49: the desktop companion

- IDs: §7; Part IV item 6; Q: Q-P7-04. **Blocked:** it needs a PROPOSED ADR (Electron or Tauri) and the owner's decision. The owner chose to decide this later.
- Goal (as §7 says): a menubar window with time-fitted suggestions and agent status, reading Week 46's API, and a notification when a wait starts (the same 45-second rule as the hook's nudge, so it isn't implemented twice).
- Tauri adds Rust, a fourth language that ARCH-2 doesn't list. Electron stays in TS but ships a much larger app. The ADR lays out this trade-off. Builds are unsigned and run locally until deploy time.

## Weeks 50–51: community-submitted questions

- IDs: §6.8; OPS-3 and OPS-4 if a model checks submissions; Q: Q-P7-05.
- Goal (as §6.8 says):
  - submission;
  - a moderation queue (the owner's admin page, like `/admin/hld-appeals`);
  - player ratings of live community questions;
  - contributor reputation that weights the ratings;
  - flagged and odd-behaving questions pulled for review, like the existing bank's.
- Who may submit, whether the second-model check also runs on submissions, the reputation formula, and where community questions appear are the owner's answers in Q-P7-05.

## Institutional features

- Not planned. The docs give no definition. Q-P7-06 asks the owner what it means; it becomes an ADR and then weeks.
