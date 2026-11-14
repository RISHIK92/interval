import { z } from "zod";
import { CONFIG, type ComponentKind } from "./catalog";
import { Design, DESIGN_VERSION, type DesignNode } from "./design";
import type { HldProblem } from "./problem";
import { CURRENT_SPEC } from "./spec";

// P6-W39 (CANVAS-1, CANVAS-2): what the canvas does to a design, as pure functions, so
// the browser only wires them up. A draft may be invalid while drawn (zones above
// nodes, a cycle); `check` says why, and the canvas saves and previews only valid ones.

export type ConfigField =
  | { name: string; type: "int"; min: number; max: number }
  | { name: string; type: "choice"; options: readonly string[] };

// A kind's configuration fields with their bounds, read from the catalog's schema so
// the form can't drift from what a design accepts.
export function configFields(kind: ComponentKind): ConfigField[] {
  return Object.entries(CONFIG[kind].shape).map(
    ([name, schema]): ConfigField => {
      if (schema instanceof z.ZodEnum)
        return { name, type: "choice", options: schema.options };
      const int = schema as z.ZodNumber;
      return {
        name,
        type: "int",
        min: int.minValue ?? 0,
        max: int.maxValue ?? 0,
      };
    },
  );
}

// A new component's configuration: the smallest of everything.
function defaultConfig(kind: ComponentKind): Record<string, number | string> {
  return Object.fromEntries(
    configFields(kind).map((f) => [
      f.name,
      f.type === "int" ? f.min : (f.options[0] ?? ""),
    ]),
  );
}

// An empty design: the problem's client, ready to be built on.
export function starterDesign(): Design {
  return {
    version: DESIGN_VERSION,
    spec: CURRENT_SPEC.version,
    nodes: [
      {
        id: "users",
        kind: "client",
        config: {},
        note: "",
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  };
}

export function addComponent(
  design: Design,
  kind: Exclude<ComponentKind, "client">,
  position: { x: number; y: number },
): Design {
  const base = kind.replaceAll("_", "-");
  const taken = new Set(design.nodes.map((n) => n.id));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${String(i)}`;
  const node = {
    id,
    kind,
    config: defaultConfig(kind),
    note: "",
    position,
  } as DesignNode;
  return { ...design, nodes: [...design.nodes, node] };
}

// The client can't be removed: a design has exactly one.
export function removeNode(design: Design, id: string): Design {
  if (design.nodes.some((n) => n.id === id && n.kind === "client"))
    return design;
  return {
    ...design,
    nodes: design.nodes.filter((n) => n.id !== id),
    edges: design.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

export function updateNode(
  design: Design,
  id: string,
  change: {
    config?: Record<string, number | string>;
    note?: string;
    position?: { x: number; y: number };
  },
): Design {
  return {
    ...design,
    nodes: design.nodes.map((n) =>
      n.id === id
        ? ({
            ...n,
            ...(change.config === undefined
              ? {}
              : { config: { ...n.config, ...change.config } }),
            ...(change.note === undefined ? {} : { note: change.note }),
            ...(change.position === undefined
              ? {}
              : { position: change.position }),
          } as DesignNode)
        : n,
    ),
  };
}

// A new edge carries every request type of the problem; the player narrows it. An edge
// that's already there is left alone.
export function connect(
  design: Design,
  problem: HldProblem,
  from: string,
  to: string,
): Design {
  if (from === to || design.edges.some((e) => e.from === from && e.to === to))
    return design;
  const routes = problem.traffic.requests.map((r) => r.type);
  return { ...design, edges: [...design.edges, { from, to, routes }] };
}

// Routes set to none removes the edge.
export function setRoutes(
  design: Design,
  from: string,
  to: string,
  routes: string[],
): Design {
  return {
    ...design,
    edges: design.edges.flatMap((e) =>
      e.from === from && e.to === to
        ? routes.length === 0
          ? []
          : [{ ...e, routes }]
        : [e],
    ),
  };
}

// Why a draft isn't a valid design yet, in words; empty when it is.
export function check(design: Design): string[] {
  const parsed = Design.safeParse(design);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const [list, at, ...rest] = issue.path;
    const field = rest.join(".");
    const where =
      list === "nodes" && typeof at === "number"
        ? design.nodes[at]?.id
        : list === "edges" && typeof at === "number"
          ? `${design.edges[at]?.from ?? "?"} → ${design.edges[at]?.to ?? "?"}`
          : undefined;
    if (where === undefined) return issue.message;
    return `${where}${field === "" ? "" : ` ${field}`}: ${issue.message}`;
  });
}

// What a valid design still can't have in this problem: components it doesn't allow,
// and routes for request types it doesn't have.
export function fitsProblem(design: Design, problem: HldProblem): string[] {
  const allowed = new Set<ComponentKind>([
    "client",
    ...problem.allowedComponents,
  ]);
  const types = new Set(problem.traffic.requests.map((r) => r.type));
  return [
    ...design.nodes
      .filter((n) => !allowed.has(n.kind))
      .map(
        (n) =>
          `${n.id}: this problem doesn't allow a ${n.kind.replaceAll("_", " ")}`,
      ),
    ...design.edges.flatMap((e) =>
      e.routes
        .filter((t) => !types.has(t))
        .map(
          (t) =>
            `${e.from} → ${e.to}: "${t}" isn't one of this problem's requests`,
        ),
    ),
  ];
}
