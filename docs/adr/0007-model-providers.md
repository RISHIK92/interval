# 0007. Model providers: OpenRouter for LLMs, Voyage AI for embeddings

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

Option C below. OpenRouter for all LLM calls (tagging, notes, later question generation, judging, coaching). Voyage AI for embeddings. The specific embedding model and dimension are picked by the Week 3 eval (Q-P1-27). This ADR overrides AI-2's provider clause ("Access is through Amazon Bedrock or Anthropic's API"). AI-2's routing by difficulty (small model for tagging, notes and titles; stronger model for the rest) still applies.

## Context

- AI-2: "A small, fast model handles tagging, notes, and titles. A stronger model handles explainer scripts, question generation, judging, and coaching. Access is through Amazon Bedrock or Anthropic's API."
- DB-3: embeddings in pgvector; the dimension is fixed in the schema.
- OPS-4, LOAD-6: per-user AI cost budgets.
- ADR-0005 owner input: Weeks 1–5 run locally, so Bedrock (which needs an AWS account and IAM) is not available until the beta.
- ADR-0008: the Python worker is the only caller of model APIs.

## Options

### A. Bedrock
- Pros: IAM auth, no API keys; Claude and embedding models in one AWS service.
- Cons: needs AWS from Week 3, against local-until-beta.
- Cost to reverse: low.

### B. Anthropic API, plus a separate embedding provider
- Pros: matches AI-2; works locally with one key.
- Cons: two providers anyway, because Anthropic has no embeddings endpoint.
- Cost to reverse: low.

### C. OpenRouter for LLMs, Voyage AI for embeddings
- Pros: one key and API for many models, so small and strong models can be swapped by config; works locally. Voyage is built for retrieval embeddings.
- Cons: a third-party router between Interval and the model vendor (latency, availability, data handling to check). Per-call cost must be read from OpenRouter's response to fill the `ai_usage` ledger. Two API keys in Secrets Manager.
- Cost to reverse: low for LLMs (calls go through `ai/gateway.py`). High for embeddings: changing the model means re-embedding every moment.

## Consequences

- `ai/gateway.py` (proposal section 9) wraps the OpenRouter and Voyage clients. No other module imports either SDK.
- Two secrets: `OPENROUTER_API_KEY`, `VOYAGE_API_KEY`. Local `.env`, Secrets Manager at beta.
- The Week 3 embedding eval compares Voyage models only.
- Cost recording: the gateway stores the cost each provider reports per call.

## Open questions

- Which OpenRouter models fill the "small" and "strong" roles. Suggested default: decided in P1-W3-S02 by the tagging eval.
- OpenRouter data-retention settings for third-party content. To check before Week 3.
