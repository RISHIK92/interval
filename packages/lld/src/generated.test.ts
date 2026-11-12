import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { Check } from "./check";
import { goTypes } from "./go";
import { Interface } from "./interface";
import { ResultLine, Scenario } from "./scenario";

// P5-W29-S01 (ADR-0040 PROPOSED): what is generated from the zod contracts is committed,
// and fails here while stale; `pnpm --filter @interval/lld codegen` (UPDATE_GENERATED=1)
// writes it.
const update = process.env["UPDATE_GENERATED"] === "1";
const root = join(import.meta.dirname, "..");

function same(
  file: string,
  fresh: string,
  compare: (a: string, b: string) => void,
) {
  if (update) writeFileSync(file, fresh);
  compare(readFileSync(file, "utf8"), fresh);
}

test("the committed JSON Schemas are the ones the zod contracts generate", () => {
  for (const [name, schema] of Object.entries({
    interface: Interface,
    scenario: Scenario,
    result: ResultLine,
    check: Check,
  }))
    same(
      join(root, "schema", `${name}.schema.json`),
      `${JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2)}\n`,
      (committed, fresh) => {
        expect(JSON.parse(committed)).toEqual(JSON.parse(fresh));
      },
    );
});

test("the checker's Go types are the ones the zod contracts generate", () => {
  same(
    join(root, "../../services/exec/lld/types.go"),
    goTypes(
      "lld",
      { Scenario, ResultLine, Check },
      { calls: "Call", concurrent: "Concurrent", "Concurrent.threads": "Call" },
    ),
    (committed, fresh) => {
      expect(committed).toBe(fresh);
    },
  );
});

test("the Go emitter refuses a rule it can't enforce, never dropping it", () => {
  // A length on a list's strings, which a []string can't carry.
  expect(() =>
    goTypes(
      "x",
      { Bad: z.strictObject({ tags: z.array(z.string().max(5)) }) },
      {},
    ),
  ).toThrow(/doesn't enforce "maxLength"/);
  // A keyword it doesn't know at all.
  expect(() =>
    goTypes("x", { Bad: z.strictObject({ id: z.string().default("a") }) }, {}),
  ).toThrow(/doesn't enforce "default"/);
});

test("the Go emitter takes a list of lists of objects only", () => {
  expect(() =>
    goTypes(
      "x",
      { Bad: z.strictObject({ grid: z.array(z.array(z.int())) }) },
      {},
    ),
  ).toThrow(/a list of lists of objects only/);
});
