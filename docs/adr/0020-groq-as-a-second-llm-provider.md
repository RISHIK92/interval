# 0020. Groq as a second LLM provider, chosen per model

- Status: ACCEPTED
- Date: 2026-10-27
- Supersedes: none (amends ADR-0007)
- Superseded by: none

## Context

ADR-0007 (ACCEPTED): "OpenRouter for all LLM calls (tagging, notes, later question generation, judging, coaching). Voyage AI for embeddings."

Picking the tagging model (P1-W3-S02, ADR-0010: "the eval picks the model") on free OpenRouter models failed on 2026-10-27:

- the strong free models were rate-limited upstream (Google's shared pool for Gemma 4), broken (NVIDIA's Nemotron 3 Super endpoint), or timed out;
- the ones that answered invented concept slugs or broke the JSON format (Laguna S 2.1).

The owner added a Groq API key (`GROQ_API_KEY`) and asked to evaluate three Groq-hosted models: `minimaxai/minimax-m2.7`, `openai/gpt-oss-120b` and `llama-3.3-70b-versatile`.

**What this touches:**

- **ADR-0008 and CLAUDE.md:** every model call goes through the Python worker's `ai/gateway.py`. This stays true.
- **OPS-4 and LOAD-6:** every call is costed and budgeted. Groq's responses report tokens but not cost, so cost comes from a price table, as Voyage's already does.
- **The `ai_provider` enum (`ai_usage`) has `openrouter` and `voyage`.** A Groq call has to be recorded as `groq`.

## Decision

Accepted by the owner on 2026-10-27: option A.

## Options

### A. Groq beside OpenRouter, the provider named in the model setting

- **The model settings name the provider:**
  - `TAGGING_MODEL=groq:openai/gpt-oss-120b`, or `openrouter:...`;
  - a bare id keeps meaning OpenRouter, so existing settings don't change;
  - the same applies to `NOTES_MODEL`.
- **The gateway:**
  - routes each call to the client for that provider;
  - records the provider and the cost, from Groq's price table, against the budget, as today.
- **Pros:**
  - The owner's models can be evaluated and used now.
  - OpenRouter stays for everything else.
  - It's one more adapter with a fake for tests, the ports-and-adapters pattern already in use (ADR-0012).
- **Cons:**
  - A second LLM vendor to watch: keys, outages, price changes.
  - The price table must be kept current by hand.
- **Cost to reverse:** low. Unset the `groq:` models and remove the adapter.

### B. Keep OpenRouter only; use the same models through OpenRouter's paid routes

- **Pros:**
  - No new provider; ADR-0007 stands.
- **Cons:**
  - Not what the owner asked.
  - Paid per call (cheap), and the owner's Groq key goes unused.
- **Cost to reverse:** none.

## Recommendation (not a decision)

**A.** The owner asked for these models through Groq. ADR-0008's single gateway and OPS-4's costing still hold, and option A keeps OpenRouter as the default.

## Consequences

- **Worker:**
  - `adapters/groq.py`: OpenAI-compatible chat completions at `https://api.groq.com/openai/v1/chat/completions`, with a price table per model and an unknown model refused, as `voyage.py` does;
  - `compose.py` builds it when `GROQ_API_KEY` is set;
  - the gateway picks the client from the model setting's prefix;
  - `.env.example` documents `GROQ_API_KEY`.
- **Database:** a migration adds `groq` to `ai_provider`, then codegen.
- **Evals:** `eval-tagging --model groq:openai/gpt-oss-120b` works the same way.

## Open questions

- Groq's prices per model, to confirm on groq.com before the table is trusted for budgets. Free-tier calls cost $0 but still count tokens.
