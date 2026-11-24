import { z } from "zod";
import {
  ChannelId,
  COMPONENT_KINDS,
  COMPONENT_NAMES,
  type ComponentKind,
} from "./catalog";
import { type Features, SPEC_VERSIONS, specVersion } from "./spec";

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
    // ADR-0050 §3, spec 2.0 only; absent, as in every 1.0 problem, means today's
    // behaviour. [work]: what one request costs a worker, in its jobs (a transcode is
    // hundreds). [bytes]: its payload, in KB. [lag]: asynchronous work's target, in
    // seconds after it is accepted, for a write handed to a queue or stream.
    work: z.number().positive().optional(),
    payloadKb: z.number().positive().optional(),
    completionSeconds: z.number().positive().optional(),
    // ADR-0051: what must do this type's work; a path that never reaches one of each
    // kind serves none of it (a code never handed to the SMS provider isn't sent).
    // Spec 2.1 adds the gateway (what pushes) and the coordination service (what
    // grants a lease) to what may be required (ADR-0052).
    requires: z
      .array(
        z.enum([
          "external_api",
          "worker",
          "connection_gateway",
          "coordination",
        ]),
      )
      .min(1)
      .optional(),
    // ADR-0050 §3, spec 2.1 only. Push: served once its path reaches a connection
    // gateway, which delivers it. [fanout]: the deliveries one request becomes, on
    // average and at the 99th percentile. [hot]: the share of its load on the busiest
    // partition of a key-value store, stream, queue or geo index.
    push: z.literal(true).optional(),
    fanout: z
      .strictObject({ mean: z.number().min(1), p99: z.number().min(1) })
      .refine((f) => f.p99 >= f.mean, "the p99 is below the mean")
      .optional(),
    hotShare: z.number().gt(0).lt(1).optional(),
    // ADR-0053: a call the picked provider doesn't charge for. A payment's fee is
    // charged once, at its capture, so its authorization is free.
    billed: z.literal(false).optional(),
  })
  .refine((r) => r.kind === "read" || !r.cacheable, {
    message: "a write is never cacheable",
  })
  .refine((r) => r.kind === "write" || r.completionSeconds === undefined, {
    message: "only a write is done later",
  });
export type RequestType = z.infer<typeof RequestType>;

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
  // ADR-0050 [lag], spec 2.0: how long the spike or outage lasts (the spec's default
  // when absent), and request types whose load differs from `load` (a burst of uploads).
  minutes: z.number().positive().optional(),
  loads: z.record(Name, z.number().positive()).optional(),
  failure: Failure.optional(),
  targets: z.strictObject({
    p99Ms: z.number().positive(), // every request type's p99
    availability: z.number().gt(0).lt(1), // the share of requests served
  }),
});
export type Scenario = z.infer<typeof Scenario>;

// Q-WD-15: what covers a requirement, checked by rules against the design and its
// simulation, never by a model. `request`: that request type is routed from the client
// to a component of one of `through`'s kinds and served on a normal day (`fast`: within
// the normal day's p99 target too). `scenario`: that scenario's targets are met.
// `storage`: the stores writes reach hold the horizon's data. `budget`: the design
// costs no more than the budget.
export const Cover = z.discriminatedUnion("rule", [
  z.strictObject({
    rule: z.literal("request"),
    request: Name,
    through: z
      .array(z.enum(COMPONENT_KINDS as [ComponentKind, ...ComponentKind[]]))
      .min(1),
    fast: z.literal(true).optional(),
  }),
  z.strictObject({ rule: z.literal("scenario"), scenario: Name }),
  z.strictObject({ rule: z.literal("storage") }),
  z.strictObject({ rule: z.literal("budget") }),
  // ADR-0053 (owner, 2026-11-24): card fees per payment within their own target.
  z.strictObject({ rule: z.literal("fees") }),
]);
export type Cover = z.infer<typeof Cover>;

// The fields each spec version's feature brings (ADR-0050 §6, ADR-0051).
const REQUEST_FEATURES = {
  work: "work",
  payloadKb: "bytes",
  completionSeconds: "lag",
  requires: "requires",
  push: "gateway",
  fanout: "fanout",
  hotShare: "hot",
  billed: "providers",
} satisfies Partial<Record<keyof RequestType, keyof Features>>;
const SCENARIO_FEATURES = {
  minutes: "lag",
  loads: "lag",
} satisfies Partial<Record<keyof Scenario, keyof Features>>;

export const HldProblem = z
  .strictObject({
    slug: z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/),
    title: z.string().min(3).max(80),
    battleMode: z.enum(["human", "ai"]).optional(),
    // The spec version its numbers were validated under (ADR-0050 §6): designs for it
    // are drawn against this version.
    spec: z
      .string()
      .refine(
        (v) => SPEC_VERSIONS.some((s) => s.version === v),
        "no such spec version",
      ),
    timeLimitMinutes: z.int().min(10).max(90),
    requirements: z.array(z.string().min(1)).min(1).max(20),
    // One per requirement, in the same order. Absent on a problem written before
    // Q-WD-15: nothing then shows as covered.
    covers: z.array(Cover).max(20).optional(),
    traffic: z.strictObject({
      requests: z.array(RequestType).min(1).max(8),
      workingSetGb: z.number().positive(), // the data reads touch
      // 0 spreads reads evenly over the working set; near 1 a few hot keys take most.
      hotKeySkew: z.number().min(0).lt(1),
      storedGb: z.number().min(0), // the data at the start
      growthGbPerDay: z.number().min(0),
      horizonDays: z.int().min(1).max(3650),
      // ADR-0050 §2, Q-WD-31: the external provider's rate limit (calls a second) and
      // price per call (USD), set by each problem that allows one.
      providerRps: z.number().positive().optional(),
      providerCostPerCall: z.number().min(0).optional(),
      // ADR-0053: or, in place of a price, the player picks the provider and channel:
      // where the users are (which sets the prices), the channels that reach them, and
      // for card payments the average ticket a fee's percentage is of and the fee per
      // payment it must stay within (owner, 2026-11-24: fees are paid apart from the
      // infrastructure budget); for push, the monthly active users a per-user price
      // is charged on.
      provider: z
        .strictObject({
          region: z.enum(["us", "in"]),
          channels: z
            .array(ChannelId)
            .min(1)
            .refine((c) => new Set(c).size === c.length, "a channel twice"),
          ticketUsd: z.number().positive().optional(),
          feeTargetUsd: z.number().positive().optional(),
          monthlyUsers: z.int().positive().optional(),
        })
        .optional(),
      // ADR-0050 §2, spec 2.1: clients connected at once on a normal day, held by the
      // connection gateway and scaled by each scenario's load.
      connections: z.number().positive().optional(),
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
    const spec = specVersion(p.spec);
    if (spec !== null) {
      // ADR-0050 §6: only what its version has, so a 1.0 problem can never take on a
      // behaviour that would move its results.
      const lacks = (path: (string | number)[], what: string) => {
        ctx.addIssue({
          code: "custom",
          path,
          message: `spec ${spec.version} has no ${what}`,
        });
      };
      for (const kind of new Set([
        ...p.allowedComponents,
        ...(p.traffic.providerRps === undefined &&
        p.traffic.providerCostPerCall === undefined
          ? []
          : (["external_api"] as const)),
      ]))
        if (spec.components[kind] === undefined)
          lacks(["allowedComponents"], COMPONENT_NAMES[kind].toLowerCase());
      const has = (feature: keyof Features) =>
        spec.features[feature] !== undefined;
      for (const [i, r] of p.traffic.requests.entries())
        for (const [field, feature] of Object.entries(REQUEST_FEATURES))
          if (r[field as keyof RequestType] !== undefined && !has(feature))
            lacks(
              ["traffic", "requests", i, field],
              `"${field}" (on "${r.type}")`,
            );
      if (p.traffic.connections !== undefined && !has("gateway"))
        lacks(["traffic", "connections"], '"connections"');
      if (p.traffic.provider !== undefined && !has("providers"))
        lacks(["traffic", "provider"], "provider to pick");
      for (const [i, sc] of p.scenarios.entries())
        for (const [field, feature] of Object.entries(SCENARIO_FEATURES))
          if (sc[field as keyof Scenario] !== undefined && !has(feature))
            lacks(["scenarios", i, field], `"${field}" (in "${sc.id}")`);
    }
    for (const [i, r] of p.traffic.requests.entries())
      for (const kind of r.requires ?? [])
        if (!p.allowedComponents.includes(kind))
          ctx.addIssue({
            code: "custom",
            path: ["traffic", "requests", i, "requires"],
            message: `"${r.type}" requires ${kind}, which isn't allowed`,
          });
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
    const offer = p.traffic.provider;
    if (
      p.allowedComponents.includes("external_api") &&
      (p.traffic.providerRps === undefined ||
        (p.traffic.providerCostPerCall === undefined && offer === undefined))
    )
      ctx.addIssue({
        code: "custom",
        path: ["traffic"],
        message: "an external provider without its rate limit and price",
      });
    if (offer !== undefined) {
      const issue = (message: string) => {
        ctx.addIssue({
          code: "custom",
          path: ["traffic", "provider"],
          message,
        });
      };
      if (p.traffic.providerCostPerCall !== undefined)
        issue("a price per call and a provider to pick");
      if (!p.allowedComponents.includes("external_api"))
        issue("a provider to pick, but no external provider allowed");
      // A card payment's fee is a share of its ticket; a message has neither.
      const card = offer.channels.includes("card");
      if (card && offer.channels.length > 1)
        issue("card payments offered with messaging channels");
      const ticket =
        offer.ticketUsd !== undefined || offer.feeTargetUsd !== undefined;
      if (
        card &&
        (offer.ticketUsd === undefined || offer.feeTargetUsd === undefined)
      )
        issue("card payments without an average ticket and a fee target");
      if (!card && ticket)
        issue("an average ticket or a fee target without card payments");
      const push = offer.channels.includes("push");
      if (push && offer.monthlyUsers === undefined)
        issue("push without its monthly active users");
      if (!push && offer.monthlyUsers !== undefined)
        issue("monthly active users without push");
    }
    for (const [i, s] of p.scenarios.entries())
      for (const t of Object.keys(s.loads ?? {}))
        if (!types.includes(t))
          ctx.addIssue({
            code: "custom",
            path: ["scenarios", i, "loads"],
            message: `no request type "${t}"`,
          });
    if (p.covers !== undefined && p.covers.length !== p.requirements.length)
      ctx.addIssue({
        code: "custom",
        path: ["covers"],
        message: "not one cover per requirement",
      });
    for (const [i, c] of (p.covers ?? []).entries()) {
      if (c.rule === "request" && !types.includes(c.request))
        ctx.addIssue({
          code: "custom",
          path: ["covers", i],
          message: `no request type "${c.request}"`,
        });
      if (c.rule === "scenario" && !ids.includes(c.scenario))
        ctx.addIssue({
          code: "custom",
          path: ["covers", i],
          message: `no scenario "${c.scenario}"`,
        });
    }
  });
export type HldProblem = z.infer<typeof HldProblem>;
