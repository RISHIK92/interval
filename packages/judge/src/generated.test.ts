import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { judgeGoTypes } from "./go";
import { JudgeJob, JudgeResult } from "./job";

// P5-W30-S05 (ADR-0040 PROPOSED): the judge's contract as JSON Schema, for any service,
// generated and stale-checked. Velox's Go types come from it (src/velox-contracts.ts,
// ADR-0041 PROPOSED).
const update = process.env["UPDATE_GENERATED"] === "1";
const root = join(import.meta.dirname, "..");

function same(file: string, fresh: string) {
  if (update) writeFileSync(file, fresh);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(fresh));
}

test("the committed JSON Schemas are the ones the contract generates", () => {
  for (const [name, schema] of Object.entries({
    job: JudgeJob,
    result: JudgeResult,
  }))
    same(
      join(root, "schema", `${name}.schema.json`),
      `${JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2)}\n`,
    );
});

// P5-W31-S02b (ADR-0040): the game server's own Go copy, for its Velox client.
test("the game server's Go types are the ones the contract generates", () => {
  const file = join(root, "../../services/game/judge/types.go");
  const fresh = judgeGoTypes("judge", "pnpm --filter @interval/judge codegen");
  if (update) writeFileSync(file, fresh);
  expect(readFileSync(file, "utf8")).toBe(fresh);
});
