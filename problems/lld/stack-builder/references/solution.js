"use strict";

// Each kind's required properties.
const REQUIRED = new Map([
  ["bucket", ["region"]],
  ["queue", ["region"]],
  ["database", ["engine", "size"]],
  ["service", ["image", "port"]],
  ["worker", ["image"]],
  ["balancer", ["port"]],
]);

// An abstract factory for a family of resources that belong together. A recipe names its
// parts after the name it's given (resources) and says how they depend on each other
// (links).
class WebRecipe {
  resources(name) {
    return [
      ["balancer", `${name}-lb`, { port: "443" }],
      ["service", `${name}-app`, { image: `${name}:latest`, port: "8080" }],
      ["database", `${name}-db`, { engine: "postgres", size: "small" }],
    ];
  }
  links(name) {
    return [
      [`${name}-lb`, `${name}-app`],
      [`${name}-app`, `${name}-db`],
    ];
  }
}

class WorkerRecipe {
  resources(name) {
    return [
      ["queue", `${name}-jobs`, { region: "us-east-1" }],
      ["worker", `${name}-worker`, { image: `${name}:latest` }],
    ];
  }
  links(name) {
    return [[`${name}-worker`, `${name}-jobs`]];
  }
}

const RECIPES = new Map([
  ["web", new WebRecipe()],
  ["worker", new WorkerRecipe()],
]);

function given(value) {
  if (value === "") throw new RangeError("empty");
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// A builder: resources and dependencies accumulate step by step, by hand or a recipe at a
// time, and nothing is ordered until the plan is asked for. Dependencies never form a
// cycle, because a link that would close one is refused when it's added.
class StackBuilder {
  #stack;
  #resources = new Map();

  constructor(name) {
    given(name);
    this.#stack = name;
  }

  resource(kind, name, props) {
    if (!REQUIRED.has(kind)) throw new RangeError("unknown kind");
    given(name);
    for (const [key, value] of Object.entries(props)) {
      given(key);
      given(value);
    }
    if (this.#resources.has(name)) return false;
    this.#resources.set(name, {
      kind,
      name,
      props: new Map(Object.entries(props)),
      needs: [], // resources this one depends on
      neededBy: [], // resources that depend on this one
    });
    return true;
  }

  dependsOn(a, b) {
    const first = this.#known(a);
    const second = this.#known(b);
    if (a === b) throw new RangeError("a resource can't depend on itself");
    if (first.needs.includes(b) || this.#reachable(b).has(a)) return false;
    first.needs.push(b);
    second.neededBy.push(a);
    return true;
  }

  preset(recipe, name) {
    const found = RECIPES.get(recipe);
    if (found === undefined) throw new RangeError("unknown recipe");
    given(name);
    const parts = found.resources(name);
    if (parts.some(([, part]) => this.#resources.has(part))) return 0;
    for (const [kind, part, props] of parts) this.resource(kind, part, props);
    for (const [a, b] of found.links(name)) this.dependsOn(a, b);
    return parts.length;
  }

  validate() {
    const problems = [];
    for (const r of this.#resources.values())
      for (const prop of REQUIRED.get(r.kind))
        if (!r.props.has(prop)) problems.push(`${r.name}: missing ${prop}`);
    return problems.sort(byCode);
  }

  plan() {
    if (this.validate().length > 0)
      throw new RangeError("the stack isn't valid");
    return this.#order(
      (r) => r.needs,
      (r) => r.neededBy,
    );
  }

  // The extension round: tearing the stack down.
  destroyPlan() {
    return this.#order(
      (r) => r.neededBy,
      (r) => r.needs,
    );
  }

  #known(name) {
    const found = this.#resources.get(name);
    if (found === undefined) throw new RangeError("unknown resource");
    return found;
  }

  // Every resource `start` depends on, directly or not.
  #reachable(start) {
    const seen = new Set([start]);
    const reached = [start];
    for (let i = 0; i < reached.length; i++)
      for (const need of this.#known(reached[i]).needs)
        if (!seen.has(need)) {
          seen.add(need);
          reached.push(need);
        }
    return seen;
  }

  // Kahn's algorithm: a resource comes once everything `before` it has, and among those
  // ready, the smallest name goes first.
  #order(before, after) {
    const waiting = new Map();
    for (const r of this.#resources.values())
      waiting.set(r.name, before(r).length);
    const ready = [...waiting]
      .filter(([, n]) => n === 0)
      .map(([name]) => name)
      .sort(byCode);
    const out = [];
    for (let i = 0; i < waiting.size; i++) {
      const resource = this.#known(ready.shift());
      out.push(`${resource.kind} ${this.#stack}/${resource.name}`);
      for (const name of after(resource)) {
        const left = waiting.get(name) - 1;
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

module.exports = { StackBuilder };
