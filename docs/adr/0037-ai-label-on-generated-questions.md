# 0037. Model-drafted questions are labeled as AI wherever they are shown

- Status: PROPOSED
- Date: 2026-11-08
- Supersedes: none
- Superseded by: none

## Context

AI-3 (docs/decisions.md): "Grounded and labeled. Every output cites its source passages and is stored separately from source text." CLAUDE.md's domain invariants: "AI output is stored separately from source text, cites its source passages, and is always labeled in UI (AI-3, AI-1)."

The drift audit of 2026-11-07 (docs/audits/2026-11-07.md, "Invariant violations") found that `apps/web/src/app/ui/AiBox.tsx`, the AI label, is used only by the feed card (`FeedCardLayout.tsx`). Questions drafted by a model appear everywhere with no AI label. These are multiple choice from QUESTIONS_MODEL (P2-W8) and the generated estimates (P3-W13-S03b). The surfaces:

- Test 60s and checkpoints;
- the solo sprint, estimation rounds and the daily challenge;
- the live 1v1 sprint and fastest finger (`play/live/sprint/SprintView.tsx`, `play/live/fastest-finger/FingerView.tsx`).

Hand-written questions (P3-W13-S03, `question.source_url` set) and model-drafted ones (`question.generator_model` set) look the same to the player.

The questions are stored apart from source text and validated before going live (Q-1, Q-2, P2-W8), so AI-3's storage and grounding parts hold. The labeling part doesn't.

ADR-0027 amended AI-3 only for the card's "why this matters" explanations; it says nothing about questions.

## Options

### A. A small "AI-drafted" mark on each model-drafted question, with its citation where the reveal already shows one

- **What:**
  - the question's screen shows "AI-drafted" beside the question number when `generator_model` is set;
  - the reveal (estimation's section link, the sprint's Read again) is unchanged;
  - live matches carry the flag in the round message from the game server's match definition.
- **Pros:**
  - meets AI-3 literally;
  - hand-written and drafted questions are told apart;
  - the data already exists (`generator_model`).
- **Cons:**
  - a visual mark on most questions (nearly all are drafted);
  - the match definition and the Go server's round message gain a field (ADR-0033's wire format, hand-written in TS and Go).
- **Cost to reverse:** low.

### B. One line per game or quiz screen: "Questions are drafted by AI from what you read, and checked before use"

- **What:** a footer on each quiz, game and live screen whenever any of its questions is model-drafted.
- **Pros:**
  - little UI noise;
  - no wire-format change for live matches (the line is known when the match is made).
- **Cons:**
  - it labels the set, not the question, so a hand-written question in a mixed set is mislabeled as AI;
  - it is weaker than "always labeled" read strictly.
- **Cost to reverse:** low.

### C. Record an exception: validated questions are not "AI output" for labeling

- **Pros:** nothing to build.
- **Cons:**
  - contradicts AI-3 and a CLAUDE.md invariant;
  - players can't tell drafted from hand-written questions;
  - it needs the owner to amend AI-3 in a further ADR.
- **Cost to reverse:** low in code, but it weakens a stated principle.

## Recommendation (not a decision)

**A.** AI-3 and the CLAUDE.md invariant say "always labeled", per output, and a question is one output. The data to tell them apart exists already. The cost is a small mark and one extra boolean in the live round message. B is acceptable if the owner finds a per-question mark too noisy, given that nearly every question is drafted. C needs an amendment to AI-3 that the docs don't support.

What would change this: if hand-written questions become rare or disappear, B labels correctly in practice and is quieter.

## Consequences

If accepted (A):

- **Web:** quiz, game and checkpoint question views show an "AI-drafted" mark for questions with `generator_model`. The served question carries an `aiDrafted` boolean from the adapters.
- **Live:** the match definition (`valkey-match-handoff.ts`) and the Go round and question messages gain `ai: boolean`; the sprint and finger views show the mark.
- **Native** (Phase 4) shows the same mark from the same fields.
- **Tests:** a drafted question shows the mark; a hand-written one doesn't.
- **The drift audit's** AI-1/AI-3 finding is closed.

## Open questions

- The exact wording: "AI-drafted", "AI", or the AiBox style used on feed cards?
- Should the share card (P3-W13-S06), which shows no question, say anything? (Today it shows none, so nothing to label.)
