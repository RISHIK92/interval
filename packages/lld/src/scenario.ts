import { z } from "zod";
import type { Interface } from "./interface";
import { fits, parseType } from "./types";

// P5-W29-S01 (LLDQ-1, EXEC-2, EXEC-4): a scenario is the calls one run makes, given to the
// harness on stdin; the harness answers each with one result line, printed raw for the
// checker outside the sandbox. "new" is the constructor and only the first call.
export const Call = z.strictObject({
  method: z.string().min(1).max(31),
  args: z.array(z.json()).max(8),
});

export const Scenario = z.strictObject({
  calls: z.array(Call).min(1).max(10_000),
});
export type Scenario = z.infer<typeof Scenario>;

// A value, or the error the call raised: exactly one, said in the structure itself so
// the generated JSON Schema and Go say it too. An error is printable ASCII (the harness
// cleans and cuts it), so every language counts its length the same.
const CallIndex = z.int().nonnegative();
export const ResultLine = z.union([
  z.strictObject({ call: CallIndex, value: z.json() }),
  z.strictObject({
    call: CallIndex,
    error: z.string().regex(/^[\x20-\x7e]{0,200}$/),
  }),
]);
export type ResultLine = z.infer<typeof ResultLine>;

// What doesn't fit the interface, call by call (empty when it all fits).
export function checkScenario(iface: Interface, scenario: Scenario): string[] {
  const out: string[] = [];
  scenario.calls.forEach((call, i) => {
    if (i === 0 && call.method !== "new") {
      out.push('the first call must be "new" (the constructor)');
      return;
    }
    if (i > 0 && call.method === "new") {
      out.push(`call ${String(i)}: "new" is only the first call`);
      return;
    }
    const params =
      call.method === "new"
        ? iface.constructor.params
        : iface.methods.find((m) => m.name === call.method)?.params;
    if (params === undefined) {
      out.push(`call ${String(i)}: unknown method "${call.method}"`);
      return;
    }
    if (call.args.length !== params.length) {
      out.push(
        `call ${String(i)}: ${call.method} takes ${String(params.length)} args, given ${String(call.args.length)}`,
      );
      return;
    }
    params.forEach((p, j) => {
      if (!fits(parseType(p.type), call.args[j]))
        out.push(`call ${String(i)} arg ${String(j + 1)}: not a ${p.type}`);
    });
  });
  return out;
}
