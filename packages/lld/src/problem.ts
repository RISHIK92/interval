import { z } from "zod";
import { Check } from "./check";
import { Interface, Method } from "./interface";
import { checkScenario, ResultLine, Scenario } from "./scenario";

// P5-W30-S01 (LLDQ-1 to LLDQ-4, Q-P5-08): a problem as written, in
// problems/lld/<slug>/problem.json beside its statement.md and references/. The visible
// scenarios are shown to players; the hidden ones never reach a client (LLDQ-4). The
// concurrency layer is W30-S02b's. The extension round (P5-W31-S02a, Q-P5-15) is
// revealed mid-battle with its own extension.md: methods added to the interface, and
// scenarios judged against the extended one. It adds and never changes: base behaviour
// differs only after an extension method is called, so every base scenario still holds.
export const Problem = z
  .strictObject({
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "kebab case")
      .max(48),
    title: z.string().min(3).max(80),
    difficulty: z.enum(["easy", "medium", "hard"]),
    // P5-W33 (§6.2, Q-P5-20): the league's pool it's drawn from; absent is human.
    league: z.enum(["human", "ai"]).optional(),
    interface: Interface,
    checks: z.array(Check).max(20).optional(),
    limits: z.strictObject({
      seconds: z.int().min(1).max(30),
      memoryMB: z.int().min(32).max(1024),
    }),
    layers: z.strictObject({
      visible: z.array(Scenario).min(1).max(20),
      hidden: z.array(Scenario).min(1).max(100),
      // P5-W30-S02b: scenarios with threads, run several times when verified.
      concurrency: z.array(Scenario).max(20).optional(),
    }),
    extension: z
      .strictObject({
        methods: z.array(Method).min(1).max(10),
        scenarios: z.array(Scenario).min(1).max(50),
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    for (const layer of ["visible", "hidden", "concurrency"] as const)
      (p.layers[layer] ?? []).forEach((s, i) => {
        // Threads belong in the concurrency layer, and only there.
        if ((layer === "concurrency") !== (s.concurrent !== undefined))
          ctx.addIssue({
            code: "custom",
            path: ["layers", layer, i],
            message:
              layer === "concurrency"
                ? "a concurrency scenario needs threads"
                : "threads belong in the concurrency layer",
          });
        for (const problem of checkScenario(p.interface, s))
          ctx.addIssue({
            code: "custom",
            path: ["layers", layer, i],
            message: problem,
          });
      });
    if (p.extension !== undefined) {
      const extended = Interface.safeParse(interfaceFor(p, "extension"));
      for (const issue of extended.error?.issues ?? [])
        ctx.addIssue({
          code: "custom",
          path: ["extension", "methods"],
          message: `the extended interface: ${issue.message}`,
        });
      const added = new Set(p.extension.methods.map((m) => m.name));
      p.extension.scenarios.forEach((s, i) => {
        const at = ["extension", "scenarios", i];
        if (s.concurrent !== undefined)
          ctx.addIssue({
            code: "custom",
            path: at,
            message: "threads belong in the concurrency layer",
          });
        if (!s.calls.some((c) => added.has(c.method)))
          ctx.addIssue({
            code: "custom",
            path: at,
            message: "an extension scenario calls an extension method",
          });
        if (extended.success)
          for (const problem of checkScenario(extended.data, s))
            ctx.addIssue({ code: "custom", path: at, message: problem });
      });
    }
    const returns = new Map(
      interfaceFor(p, "extension").methods.map((m) => [m.name, m.returns]),
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

const LAYERS = ["visible", "hidden", "concurrency", "extension"] as const;
export type Layer = (typeof LAYERS)[number];

// The interface a layer is judged against: the base one, or after the reveal the base
// with the extension's methods. A base layer's harness never calls an extension
// method, so a solution written before the reveal still compiles.
export function interfaceFor(
  p: Pick<Problem, "interface" | "extension">,
  layer: Layer,
): Interface {
  if (layer !== "extension" || p.extension === undefined) return p.interface;
  return {
    ...p.interface,
    methods: [...p.interface.methods, ...p.extension.methods],
  };
}

// Every scenario, in a fixed order: the expected results are recorded in this order.
export function scenariosOf(p: Problem): {
  layer: Layer;
  index: number;
  scenario: Scenario;
}[] {
  const layers: Record<Layer, Scenario[]> = {
    visible: p.layers.visible,
    hidden: p.layers.hidden,
    concurrency: p.layers.concurrency ?? [],
    extension: p.extension?.scenarios ?? [],
  };
  return LAYERS.flatMap((layer) =>
    layers[layer].map((scenario, index) => ({ layer, index, scenario })),
  );
}

// A problem's expected.json (P5-W30-S01): the Python reference's results for every
// scenario, in scenariosOf order, written by verify and read by the loader (W31-S01).
export const Expected = z.array(
  z.strictObject({
    layer: z.enum(LAYERS),
    index: z.int().min(0),
    results: z.array(ResultLine),
  }),
);
export type Expected = z.infer<typeof Expected>;
