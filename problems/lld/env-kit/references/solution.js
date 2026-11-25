"use strict";

// An abstract factory: one family's way of making each kind of component (queue, store,
// clock). The kit only ever asks the family in use, so every component it makes belongs
// together.
class Local {
  name = "local";
  queue() {
    return "inmem-queue";
  }
  store() {
    return "sqlite-store";
  }
  clock() {
    return "fake-clock";
  }
}

class Ci {
  name = "ci";
  queue() {
    return "valkey-queue";
  }
  store() {
    return "postgres-store";
  }
  clock() {
    return "fixed-clock";
  }
}

class Staging {
  name = "staging";
  queue() {
    return "sqs-queue";
  }
  store() {
    return "rds-store";
  }
  clock() {
    return "system-clock";
  }
}

// A family defined at run time: its components are named after its prefix.
class Prefixed {
  #prefix;

  constructor(name, prefix) {
    this.name = name;
    this.#prefix = prefix;
  }
  queue() {
    return `${this.#prefix}-queue`;
  }
  store() {
    return `${this.#prefix}-store`;
  }
  clock() {
    return `${this.#prefix}-clock`;
  }
}

// Each kind is one of the factory's methods; the kit never names a concrete family.
const KINDS = new Map([
  ["queue", (f) => f.queue()],
  ["store", (f) => f.store()],
  ["clock", (f) => f.clock()],
]);

class EnvKit {
  #families = new Map(
    [new Local(), new Ci(), new Staging()].map((f) => [f.name, f]),
  );
  #current = null;
  #made = new Map(); // component id -> family name

  use(family) {
    const found = this.#families.get(family);
    if (found === undefined) throw new RangeError("unknown family");
    this.#current = found;
  }

  component(kind) {
    const make = KINDS.get(kind);
    if (make === undefined) throw new RangeError("unknown kind");
    if (this.#current === null) throw new RangeError("no family in use");
    const made = `${make(this.#current)}#${this.#made.size + 1}`;
    this.#made.set(made, this.#current.name);
    return made;
  }

  wire(a, b) {
    if (a === b) throw new RangeError("a component can't be wired to itself");
    return this.family(a) === this.family(b);
  }

  family(componentId) {
    const found = this.#made.get(componentId);
    if (found === undefined) throw new RangeError("unknown component");
    return found;
  }

  // The extension round: a family that isn't built in.
  defineFamily(name, prefix) {
    if (name === "" || prefix === "") throw new RangeError("empty");
    if (this.#families.has(name)) throw new RangeError("family exists");
    this.#families.set(name, new Prefixed(name, prefix));
  }
}

module.exports = { EnvKit };
