# 0040. Nested contracts are defined in zod; their JSON Schema and Go types are generated

- Status: PROPOSED
- Date: 2026-11-12
- Supersedes: none
- Superseded by: none

## Context

ADR-0010 gives cross-language contracts one source: a JSON Schema per queue message, with TS and Python types generated from it by `interval_db.messages_codegen`, checked by `pnpm db:check`. That generator supports only flat objects of scalars (its `TOP_LEVEL` keywords and `UnsupportedSchemaError`).

Two contracts since then are nested:

- **The diagram timeline** (P4.5-W25-S02, TTS-5). The worker validates drafts against it. docs/roadmap/phase-4.5-slices.md records the owner's 2026-11-11 answer: "Python validates drafts against the generated JSON Schema with jsonschema 4.26.0, structure only, with no typed Python". The 2026-11-12 drift audit lists this under "Needs an ADR": "ADR-0010 says nothing about the timeline's inverted direction."
- **LLD battles' interface, scenario and result** (LLDQ-1, P5-W29-S01).
  - An interface has a recursive type grammar (`list<map<string,optional<int>>>`).
  - The TS generators (W29-S02) need the grammar and the semantic rules: names valid in five languages, the constructor first, arg types.
  - The Go checker (W29-S03) needs only the scenario and result shapes, but it is the trust boundary for sandbox output (EXEC-4), so it needs every rule of those two.

**This amends Q-P5-06's answer.** That answer (overnight, recommended, 2026-11-12) says the schema "lives in `packages/lld` as JSON Schema with generated TS and Go types", with JSON Schema as the source, which is ADR-0010's direction. P5-W29-S01 was built the other way, on this ADR; the owner accepts or rejects it.

The audit names a third mechanism: payloads written by hand on each side (match, result, WebSocket, push, captions, caption anchors). They are **out of this ADR's scope**. They stay as they are until a slice touches them; ARCH-2 calls for one of these two mechanisms then.

## Options

### A. zod in a TS package is the source; JSON Schema and Go types are generated from it

The JSON Schema comes from `z.toJSONSchema(…, { io: "input" })`. Go types come from a small emitter over that schema, run through gofmt. Both are committed and fail a test while stale.

- Pros:
  - The rules a schema can't say (refinements) live beside the structure, in the one language that has to apply them.
  - It is already how the timeline works (owner-approved).
  - No new dependency.
- Cons:
  - It inverts ADR-0010's direction for these contracts.
  - Python and Go see structure only. Semantic checks happen in TS: at review for timelines, in the pipeline for problems.
- Cost to reverse: low. The committed JSON Schemas could become hand-edited sources at any time.

### B. Extend ADR-0010's Python generator to nested schemas and to Go

- Pros: one generator, one direction.
- Cons:
  - A substantial generator (refs, arrays, unions, recursion) for three languages.
  - The semantic rules would still be hand-written in TS, so they would be defined apart from the structure.
- Cost to reverse: medium.

### C. Hand-written JSON Schema with a third-party generator for each language

- Pros: standard tooling.
- Cons: new dependencies in three ecosystems. The semantic rules are still in TS.
- Cost to reverse: medium.

## Recommendation (not a decision)

Option A for nested contracts that TS must interpret; ADR-0010 stays as it is for flat queue messages. ARCH-2's "nothing implemented twice" holds either way, since each fact is defined once, and A meets it with no new dependency. B would become worth its cost if Python ever needs typed access to a nested contract.

## Consequences

- `packages/diagrams` (timeline) and `packages/lld` (interface, scenario, result) are the sources.
- **Go:** the generated code includes a `Decode` per contract, which refuses unknown fields and trailing data and checks required fields, a union's exactly-one form, bounds and patterns. Go keeps no hand-written copy of a rule.
- **Refinements** (naming, uniqueness, the type grammar) are not in the JSON Schema. The interface schema's description says so.
- **Tooling:** `@interval/lld`'s tests need `gofmt` on PATH, since they run it on the generated Go. CI installs Go before `pnpm check`.
- `packages/*/schema/*.schema.json` and `services/exec/lld/types.go` are generated. `pnpm --filter <pkg> schema|codegen` regenerates them; the tests fail while they are stale.
- Open: whether the owner wants this recorded for future nested contracts by default.
