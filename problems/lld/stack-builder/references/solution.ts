// Each kind's required properties.
const REQUIRED = new Map<string, string[]>([
  ["bucket", ["region"]],
  ["queue", ["region"]],
  ["database", ["engine", "size"]],
  ["service", ["image", "port"]],
  ["worker", ["image"]],
  ["balancer", ["port"]],
]);

interface Resource {
  readonly kind: string;
  readonly name: string;
  readonly props: Map<string, string>;
  readonly needs: string[]; // resources this one depends on
  readonly neededBy: string[]; // resources that depend on this one
}

type Part = [kind: string, name: string, props: Record<string, string>];

// An abstract factory for a family of resources that belong together. A recipe names its
// parts after the name it's given and says how they depend on each other.
interface Recipe {
  resources(name: string): Part[];
  links(name: string): [string, string][];
}

class WebRecipe implements Recipe {
  resources(name: string): Part[] {
    return [
      ["balancer", `${name}-lb`, { port: "443" }],
      ["service", `${name}-app`, { image: `${name}:latest`, port: "8080" }],
      ["database", `${name}-db`, { engine: "postgres", size: "small" }],
    ];
  }
  links(name: string): [string, string][] {
    return [
      [`${name}-lb`, `${name}-app`],
      [`${name}-app`, `${name}-db`],
    ];
  }
}

class WorkerRecipe implements Recipe {
  resources(name: string): Part[] {
    return [
      ["queue", `${name}-jobs`, { region: "us-east-1" }],
      ["worker", `${name}-worker`, { image: `${name}:latest` }],
    ];
  }
  links(name: string): [string, string][] {
    return [[`${name}-worker`, `${name}-jobs`]];
  }
}

const RECIPES = new Map<string, Recipe>([
  ["web", new WebRecipe()],
  ["worker", new WorkerRecipe()],
]);

function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// A builder: resources and dependencies accumulate step by step, by hand or a recipe at a
// time, and nothing is ordered until the plan is asked for. Dependencies never form a
// cycle, because a link that would close one is refused when it's added.
export class StackBuilder {
  private readonly stack: string;
  private readonly resources = new Map<string, Resource>();

  constructor(name: string) {
    given(name);
    this.stack = name;
  }

  resource(kind: string, name: string, props: Record<string, string>): boolean {
    if (!REQUIRED.has(kind)) throw new RangeError("unknown kind");
    given(name);
    for (const [key, value] of Object.entries(props)) {
      given(key);
      given(value);
    }
    if (this.resources.has(name)) return false;
    this.resources.set(name, {
      kind,
      name,
      props: new Map(Object.entries(props)),
      needs: [],
      neededBy: [],
    });
    return true;
  }

  dependsOn(a: string, b: string): boolean {
    const first = this.known(a);
    const second = this.known(b);
    if (a === b) throw new RangeError("a resource can't depend on itself");
    if (first.needs.includes(b) || this.reachable(b).has(a)) return false;
    first.needs.push(b);
    second.neededBy.push(a);
    return true;
  }

  preset(recipe: string, name: string): number {
    const found = RECIPES.get(recipe);
    if (found === undefined) throw new RangeError("unknown recipe");
    given(name);
    const parts = found.resources(name);
    if (parts.some(([, part]) => this.resources.has(part))) return 0;
    for (const [kind, part, props] of parts) this.resource(kind, part, props);
    for (const [a, b] of found.links(name)) this.dependsOn(a, b);
    return parts.length;
  }

  validate(): string[] {
    const problems: string[] = [];
    for (const r of this.resources.values())
      for (const prop of REQUIRED.get(r.kind) ?? [])
        if (!r.props.has(prop)) problems.push(`${r.name}: missing ${prop}`);
    return problems.sort(byCode);
  }

  plan(): string[] {
    if (this.validate().length > 0)
      throw new RangeError("the stack isn't valid");
    return this.order(
      (r) => r.needs,
      (r) => r.neededBy,
    );
  }

  // The extension round: tearing the stack down.
  destroyPlan(): string[] {
    return this.order(
      (r) => r.neededBy,
      (r) => r.needs,
    );
  }

  private known(name: string): Resource {
    const found = this.resources.get(name);
    if (found === undefined) throw new RangeError("unknown resource");
    return found;
  }

  // Every resource `start` depends on, directly or not.
  private reachable(start: string): Set<string> {
    const seen = new Set([start]);
    const reached = [start];
    for (let i = 0; i < reached.length; i++)
      for (const need of this.known(reached[i] ?? "").needs)
        if (!seen.has(need)) {
          seen.add(need);
          reached.push(need);
        }
    return seen;
  }

  // Kahn's algorithm: a resource comes once everything `before` it has, and among those
  // ready, the smallest name goes first.
  private order(
    before: (r: Resource) => string[],
    after: (r: Resource) => string[],
  ): string[] {
    const waiting = new Map<string, number>();
    for (const r of this.resources.values())
      waiting.set(r.name, before(r).length);
    const ready = [...waiting]
      .filter(([, n]) => n === 0)
      .map(([name]) => name)
      .sort(byCode);
    const out: string[] = [];
    for (let i = 0; i < waiting.size; i++) {
      const resource = this.known(ready.shift() ?? "");
      out.push(`${resource.kind} ${this.stack}/${resource.name}`);
      for (const name of after(resource)) {
        const left = (waiting.get(name) ?? 0) - 1;
        waiting.set(name, left);
        if (left === 0) {
          // Kept sorted, so the next resource is always the first.
          const at = ready.findIndex((other) => other > name);
          ready.splice(at === -1 ? ready.length : at, 0, name);
        }
      }
    }
    return out;
  }
}
