# 0021. Google's Gemini API as an LLM provider, chosen per model like Groq

- Status: ACCEPTED
- Date: 2026-10-27
- Supersedes: none (extends ADR-0020, amends ADR-0007)
- Superseded by: none

## Context

ADR-0020 (ACCEPTED) added Groq beside OpenRouter, picked per model with a `groq:` prefix, costed from a price table, through the one gateway (ADR-0008, OPS-4).

Free Gemma 4 31B through OpenRouter failed every time on 2026-10-27, because Google's shared free pool was rate-limited. OpenRouter's own hint was to use one's own Google key. The owner added `GOOGLE_API_KEY` and asked to evaluate `gemma-4-31b-it` with it.

Google's Gemini API has an OpenAI-compatible chat endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`. It's the same request and response shape as Groq's.

## Decision

Accepted by the owner on 2026-10-27: option A.

## Options

### A. A `google:` prefix, through the same OpenAI-compatible client as Groq

- **One adapter for both providers:** `GroqClient` becomes `OpenAiCompatibleClient`, parameterised by provider, URL, key and price table.
- **The gateway** routes `groq:` and `google:` to their clients; a bare id stays OpenRouter.
- **A migration** adds `google` to `ai_provider`.
- **Prices:** Gemma models are free in the Gemini API, priced at $0 in the table and still recorded with their token counts.
- **Pros:**
  - The owner's own quota, not the shared pool.
  - Almost no new code (one adapter reused).
- **Cons:**
  - A third LLM vendor.
  - Google's free-tier limits apply per key.
- **Cost to reverse:** low.

### B. The Google key inside OpenRouter (bring your own key)

The owner adds the key in OpenRouter's settings; there's no code change.

- **Pros:**
  - No new provider in the code.
- **Cons:**
  - The key lives in OpenRouter's settings, not `.env`.
  - It's not what the owner asked.
- **Cost to reverse:** none.

## Recommendation (not a decision)

**A.** It's what the owner asked, and it reuses ADR-0020's design unchanged.

## Consequences

- **Worker:**
  - `adapters/groq.py` becomes `adapters/openai_compatible.py`, holding both providers' URLs and price tables;
  - `compose.py` builds a Google client when `GOOGLE_API_KEY` is set;
  - the gateway takes the extra providers as a mapping from prefix to client.
- **Database:** a migration adds `google` to `ai_provider`.
- **`.env.example`** documents `GOOGLE_API_KEY`.

## Open questions

- Whether Google's Gemma pricing stays free; the table says $0 until it changes.
