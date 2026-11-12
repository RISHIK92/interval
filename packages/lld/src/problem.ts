import { z } from "zod";
import { Check } from "./check";
import { Interface } from "./interface";
import { checkScenario, Scenario } from "./scenario";

// P5-W30-S01 (LLDQ-1 to LLDQ-4, Q-P5-08): a problem as written, in
// problems/lld/<slug>/problem.json beside its statement.md and references/. The visible
// scenarios are shown to players; the hidden ones never reach a client (LLDQ-4). The
// concurrency and extension layers arrive with their slices (W30-S02, W31-S02).
export const Problem = z
  .strictObject({
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "kebab case")
      .max(48),
    title: z.string().min(3).max(80),
    difficulty: z.enum(["easy", "medium", "hard"]),
    interface: Interface,
    checks: z.array(Check).max(20).optional(),
    limits: z.strictObject({
      seconds: z.int().min(1).max(30),
      memoryMB: z.int().min(32).max(1024),
    }),
    layers: z.strictObject({
      visible: z.array(Scenario).min(1).max(20),
      hidden: z.array(Scenario).min(1).max(100),
    }),
  })
  .superRefine((p, ctx) => {
    for (const layer of ["visible", "hidden"] as const)
      p.layers[layer].forEach((s, i) => {
        for (const problem of checkScenario(p.interface, s))
          ctx.addIssue({
            code: "custom",
            path: ["layers", layer, i],
            message: problem,
          });
      });
    const returns = new Map(
      p.interface.methods.map((m) => [m.name, m.returns]),
    );
    for (const c of p.checks ?? []) {
      const r = returns.get(c.method);
      const issue = (message: string) => {
        ctx.addIssue({ code: "custom", path: ["checks"], message });
      };
      if (r === undefined) issue(`a check for unknown method "${c.method}"`);
      else if (r === "void")
        issue(`a check for "${c.method}", which returns nothing`);
      else if (c.compare === "unordered" && !r.startsWith("list<"))
        issue(`"${c.method}" doesn't return a list, so it can't be unordered`);
      if (c.tolerance !== undefined && c.compare !== "approx")
        issue(`a tolerance on "${c.method}", whose comparison isn't approx`);
    }
    if (
      new Set((p.checks ?? []).map((c) => c.method)).size !==
      (p.checks ?? []).length
    )
      ctx.addIssue({
        code: "custom",
        path: ["checks"],
        message: "two checks for one method",
      });
  });
export type Problem = z.infer<typeof Problem>;

// Every scenario, in a fixed order: the expected results are recorded in this order.
export function scenariosOf(
  p: Problem,
): { layer: "visible" | "hidden"; index: number; scenario: Scenario }[] {
  return (["visible", "hidden"] as const).flatMap((layer) =>
    p.layers[layer].map((scenario, index) => ({ layer, index, scenario })),
  );
}
