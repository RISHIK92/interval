import { z } from "zod";
import { COMPONENT_KINDS, type ComponentKind } from "./catalog";

// P6-W37 (HLDQ-1; Q-P6-02): an HLD problem: its requirements, numeric targets, traffic
// shape, scenarios, rubric, concepts, allowed components and time limit. Scenarios are
// what the simulator runs a design through; the rubric is the AI judge's (W41).

const Name = z.string().regex(/^[a-z][a-z_]{0,23}$/);

export const RequestType = z
  .strictObject({
    type: Name, // what edges route: "read", "write", "upload", …
    rps: z.number().positive(), // at baseline load
    // A write goes to a relational database's primary; a read may go to a replica.
    kind: z.enum(["read", "write"]),
    // A read a cache or CDN may answer (a search or a personal feed may not be).
    cacheable: z.boolean(),
  })
  .refine((r) => r.kind === "read" || !r.cacheable, {
    message: "a write is never cacheable",
  });

export const Failure = z.strictObject({
  scope: z.enum(["node", "zone", "region"]),
  // A node failure hits one node of each component of this kind (every kind when
  // absent); a zone or region failure takes everything placed there.
  kind: z
    .enum(COMPONENT_KINDS as [ComponentKind, ...ComponentKind[]])
    .optional(),
});

export const Scenario = z.strictObject({
  id: Name,
  name: z.string().min(1).max(80),
  weight: z.number().positive(),
  load: z.number().positive(), // times baseline traffic
  failure: Failure.optional(),
  targets: z.strictObject({
    p99Ms: z.number().positive(), // every request type's p99
    availability: z.number().gt(0).lt(1), // the share of requests served
  }),
});
export type Scenario = z.infer<typeof Scenario>;

export const HldProblem = z
  .strictObject({
    slug: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/),
    title: z.string().min(3).max(80),
    league: z.enum(["human", "ai"]).optional(),
    timeLimitMinutes: z.int().min(10).max(90),
    requirements: z.array(z.string().min(1)).min(1).max(20),
    traffic: z.strictObject({
      requests: z.array(RequestType).min(1).max(8),
      workingSetGb: z.number().positive(), // the data reads touch
      // 0 spreads reads evenly over the working set; near 1 a few hot keys take most.
      hotKeySkew: z.number().min(0).lt(1),
      storedGb: z.number().min(0), // the data at the start
      growthGbPerDay: z.number().min(0),
      horizonDays: z.int().min(1).max(3650),
    }),
    budgetPerMonth: z.number().positive(), // USD (Q-P6-02)
    scenarios: z.array(Scenario).min(1).max(10),
    allowedComponents: z
      .array(z.enum(COMPONENT_KINDS as [ComponentKind, ...ComponentKind[]]))
      .min(1),
    rubric: z
      .array(
        z.strictObject({
          id: Name,
          criterion: z.string().min(1).max(400),
          weight: z.number().positive(),
        }),
      )
      .min(1)
      .max(10),
    concepts: z.array(z.string().min(1)).max(20),
  })
  .superRefine((p, ctx) => {
    // §6.4: the baseline gate needs a baseline.
    if (!p.scenarios.some((s) => s.id === "baseline"))
      ctx.addIssue({
        code: "custom",
        path: ["scenarios"],
        message: "no baseline scenario",
      });
    const ids = p.scenarios.map((s) => s.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        path: ["scenarios"],
        message: "a scenario id used twice",
      });
    const types = p.traffic.requests.map((r) => r.type);
    if (new Set(types).size !== types.length)
      ctx.addIssue({
        code: "custom",
        path: ["traffic"],
        message: "a request type used twice",
      });
  });
export type HldProblem = z.infer<typeof HldProblem>;
