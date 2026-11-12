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

// P5-W30-S02b (LLDQ-3, §6.5): a concurrency scenario runs `after` of its calls, then its
// threads at once (each thread's calls in order), then the rest of its calls once every
// thread has finished. Only `calls` get result lines: a thread's own results depend on
// timing, so what is judged is the state the later calls see.
export const Concurrent = z.strictObject({
  after: z.int().min(1),
  threads: z.array(z.array(Call).min(1).max(1000)).min(2).max(8),
});

export const Scenario = z.strictObject({
  calls: z.array(Call).min(1).max(10_000),
  concurrent: Concurrent.optional(),
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
  const checkArgs = (
    name: string,
    params: Interface["constructor"]["params"],
    args: unknown[],
    where: string,
  ) => {
    if (args.length !== params.length) {
      out.push(
        `${where}: ${name} takes ${String(params.length)} args, given ${String(args.length)}`,
      );
      return;
    }
    params.forEach((p, j) => {
      if (!fits(parseType(p.type), args[j]))
        out.push(`${where} arg ${String(j + 1)}: not a ${p.type}`);
    });
  };
  const checkCall = (call: Scenario["calls"][number], where: string) => {
    if (call.method === "new") {
      out.push(`${where}: "new" is only the first call`);
      return;
    }
    const params = iface.methods.find((m) => m.name === call.method)?.params;
    if (params === undefined)
      out.push(`${where}: unknown method "${call.method}"`);
    else checkArgs(call.method, params, call.args, where);
  };
  scenario.calls.forEach((call, i) => {
    if (i > 0) checkCall(call, `call ${String(i)}`);
    else if (call.method !== "new")
      out.push('the first call must be "new" (the constructor)');
    else checkArgs("new", iface.constructor.params, call.args, "call 0");
  });
  const c = scenario.concurrent;
  if (c !== undefined) {
    // What's judged is the state later calls see, so at least one must follow.
    if (c.after >= scenario.calls.length)
      out.push(
        `the threads start after ${String(c.after)} calls, but no call follows them (there are ${String(scenario.calls.length)})`,
      );
    c.threads.forEach((thread, t) => {
      thread.forEach((call, i) => {
        checkCall(call, `thread ${String(t)} call ${String(i)}`);
      });
    });
  }
  return out;
}
