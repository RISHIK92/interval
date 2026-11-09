# 0038. Explainer scripts: the question-generation model class, within the owner's price rule

- Status: ACCEPTED
- Date: 2026-11-09
- Supersedes: none
- Superseded by: none

## Context

P4-W22-S01 ("Concept explainer scripts") needs "the explainer-model ADR" before it starts. §5G: "each concept gets an original explainer, written by AI from several sources with citations".

AI-2 (docs/decisions.md): "A small, fast model handles tagging, notes, and titles. A stronger model handles explainer scripts, question generation, judging, and coaching." ADR-0007 moved every LLM call to OpenRouter and kept AI-2's routing by difficulty.

The owner's standing rules for this project:

- never run a model above $0.80 per million output tokens;
- the AI budget cap stays at 30 cents a day (OPS-4).

Q-P4-06 (owner, 2026-11-07) answers the suggested default: "a model within the price rule (the one QUESTIONS_MODEL uses), scripts generated once per concept (AI-4) within the existing budget, labeled as AI with citations".

Q-P4-11 (owner, 2026-11-07):

- 60–120 seconds a concept;
- only sources whose rights profile allows full text (ING-2);
- citations shown under the player;
- the owner approves a script before it is voiced.

What "a stronger model" means here is unsettled. The usual stronger models cost far more than $0.80 per million output tokens. Without a decision, the slice would either break the owner's price rule or quietly read AI-2 differently.

## Decision

Accepted by the owner on 2026-11-09: option A. `EXPLAINER_MODEL` stays unset (no model runs) until the owner sets it.

## Options

### A. The question-generation class, its own switch (`EXPLAINER_MODEL`)

AI-2 already puts explainer scripts and question generation in the same tier. Explainers use a model of the class QUESTIONS_MODEL uses, chosen by the owner within the $0.80 rule.

- **The setting:** `EXPLAINER_MODEL` in env (ADR-0011); unset means no scripts are written (as every model setting).
- **Calls:** through `ai/gateway.py` (ADR-0008), recorded under a new `ai_feature` value `explainer`, counted against the daily cap (OPS-4).
- **Volume:** one script per concept, never regenerated unless the owner rejects it (AI-4). At roughly 6,000 input and 400 output tokens a script, a few concepts a day fit in 30 cents on models of this class.

- Pros:
  - matches AI-2's tiering as written (explainers sit with question generation);
  - keeps the owner's price rule and budget;
  - its own switch, so explainers can be off while questions run (the owner approves each script anyway);
  - no new provider.
- Cons: a model at this price writes plainer scripts than the strongest models. The owner's approval step (Q-P4-11) is the quality gate.
- Cost to reverse: low. Changing the env value changes the model; the code doesn't name one.

### B. A stronger model above the price rule, for scripts only

- Pros: better scripts on the first draft.
- Cons:
  - breaks the owner's standing rule;
  - one script could cost more than a day's cap;
  - needs the owner to lift the rule, which they haven't.
- Cost to reverse: low in code; high in spend if it runs unattended.

### C. Reuse `QUESTIONS_MODEL` itself, with no switch of its own

- Pros: one setting fewer.
- Cons:
  - explainers can't be switched off while questions run;
  - a batch value (`batch:…`, Q-P2-13) doesn't fit a once-per-concept job;
  - the cost per feature can't be read apart.
- Cost to reverse: low.

## Recommendation (not a decision)

**A.** It follows AI-2's text, which already groups explainer scripts with question generation, and the owner's answer to Q-P4-06. It keeps the $0.80 rule and the 30-cent cap, and gives the feature its own off switch and its own line in the AI usage records (OPS-4).

What would change this: the owner lifting the price rule for explainers (B), or wanting one switch for all generation (C).

## Consequences

- **Migration:** `ai_feature` gains `explainer` (local first, ADR-0013).
- **`.env.example`:** gains `EXPLAINER_MODEL` (unset: off), and both deployment modes pass it to the worker only (ADR-0011).
- **The worker's explainer job (P4-W22-S01):**
  - goes through the gateway with the budget check;
  - writes once per concept (AI-4), only from sources whose rights profile allows full text (ING-2);
  - stores scripts apart from source text, with citations (AI-3);
  - keeps them pending until the owner approves at `/admin/explainers`.
- P4-W22-S01 is unblocked once this is accepted.

## Open questions

- Which model the owner sets for `EXPLAINER_MODEL`. It can be the same one QUESTIONS_MODEL names when that isn't a batch value.
