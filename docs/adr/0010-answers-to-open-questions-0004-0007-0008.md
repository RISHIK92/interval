# 0010. Answers to open questions in ADR-0004, ADR-0007 and ADR-0008

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none (answers open questions that ADRs 0004, 0007 and 0008 left open; their decisions stand)
- Superseded by: none

## Decision (owner, 2026-10-25)

1. **Queue contracts join the codegen (ADR-0008).** Each SQS message is one JSON Schema file in `packages/db/messages/`. The ADR-0002 codegen generates zod schemas for TS and pydantic models for Python from it. CI fails if the generated files are stale.
2. **GitHub becomes a sign-in method in Phase 2 (ADR-0004).** GitHub is also the account connection for project features. Phase 1 stays email + password only.
3. **OpenRouter models are picked by the tagging eval (ADR-0007).** P1-W3-S02 compares candidate models for the small and strong roles (AI-2) on accuracy and cost. The owner approves the result, and the model IDs live in config.
4. **OpenRouter data policy uses the defaults (ADR-0007).** No zero-retention or no-training restriction is set on the account.
5. **Partner full-text display is deferred (ING-2).** The "full text for display (partners)" level exists in the rights schema, but no Phase 1 code displays full text. A later ADR defines the display rules before the first partner source.
6. **Per-user AI budgets are built in Phase 1 (OPS-4).** The ledger and checks cover both global and per-user scope. Dollar limits are set before the beta (Q-P1-23).

## Context

- ADR-0008 open question: "Do SQS message contracts (JSON Schema in `packages/db/messages/`) join ADR-0002's codegen, so TS and Python share one definition?"
- ADR-0004 open question: "Should GitHub also be a sign-in method in Phase 2, or only a connection?"
- ADR-0007 open questions: "Which OpenRouter models fill the 'small' and 'strong' roles" and "OpenRouter data-retention settings for third-party content."
- docs/proposals/phase-1-skeleton.md section 9, "Needs ADR" items 4 and 5.

ADRs 0004, 0007 and 0008 are ACCEPTED and are not edited (docs/adr/README.md), so the answers are recorded here.

## Options

Each item was a choice between the suggested default and the alternatives the owner was shown on 2026-10-25. For item 2 the suggested default was "connection only", and the owner chose sign-in as well. For item 4 the suggested default was zero-retention routing only, and the owner chose the OpenRouter defaults.

## Consequences

- P1-W2-S02 adds the message schemas and their codegen step. `pnpm db:check` and CI cover both DB types and message types.
- Phase 2 adds Better Auth's GitHub provider. Account linking between an email account and a GitHub sign-in needs a rule then (open question below).
- Item 4: providers behind OpenRouter may keep prompts under their own policies. ING-2 still gates what is sent: the gateway sends only the text a source's rights profile allows for processing, and metadata-only sources send no body text.
- Item 5: the rights matrix code (`rights.py`) treats partner display as not allowed until that ADR exists.

## Open questions

- Phase 2: when a GitHub sign-in's email matches an existing email + password account, are the accounts linked automatically or only after the user confirms?
