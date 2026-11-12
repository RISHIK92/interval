import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
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
    goTypes("lld", { Scenario, ResultLine }, { calls: "Call" }),
    (committed, fresh) => {
      expect(committed).toBe(fresh);
    },
  );
});
