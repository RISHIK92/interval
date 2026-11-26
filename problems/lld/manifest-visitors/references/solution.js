"use strict";

const LOAD_BALANCER = 20;
const MOST = 1_000_000;
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The elements: each one's accept(visitor) calls the visitor's method for its kind.
class Deployment {
  constructor(name, f) {
    this.name = name;
    this.replicas = f.replicas;
    this.cpu = f.cpu;
    this.memory = f.memory;
    this.privileged = f.privileged === 1;
  }

  accept(v) {
    v.deployment(this);
  }
}

class Service {
  constructor(name, f) {
    this.name = name;
    this.port = f.port;
    this.public = f.public === 1;
  }

  accept(v) {
    v.service(this);
  }
}

class ConfigMap {
  constructor(name, f) {
    this.name = name;
    this.entries = f.entries;
    this.secrets = f.secrets ?? 0;
  }

  accept(v) {
    v.configmap(this);
  }
}

// One operation over every kind: deployment(d), service(s) and configmap(c). A new
// operation is a new visitor; the manifest classes above never change for it.
class Visitor {
  constructor() {
    this.lines = [];
  }

  finish() {
    return this.lines;
  }
}

class Inventory extends Visitor {
  deployment(d) {
    this.lines.push(`deployment/${d.name} replicas=${d.replicas}`);
  }

  service(s) {
    this.lines.push(`service/${s.name} port=${s.port}`);
  }

  configmap(c) {
    this.lines.push(`configmap/${c.name} entries=${c.entries}`);
  }
}

class Lint extends Visitor {
  deployment(d) {
    if (d.replicas === 1)
      this.lines.push(`deployment/${d.name}: single replica`);
    if (d.cpu === undefined)
      this.lines.push(`deployment/${d.name}: no cpu limit`);
  }

  service() {
    // Nothing about a service is linted yet.
  }

  configmap(c) {
    if (c.entries === 0) this.lines.push(`configmap/${c.name}: empty`);
  }
}

class Cost extends Visitor {
  constructor() {
    super();
    this.total = 0;
  }

  add(what, cost) {
    this.lines.push(`${what} ${cost}`);
    this.total += cost;
  }

  deployment(d) {
    this.add(
      `deployment/${d.name}`,
      d.replicas * ((d.cpu ?? 0) + (d.memory ?? 0)),
    );
  }

  service(s) {
    this.add(`service/${s.name}`, s.public ? LOAD_BALANCER : 0);
  }

  configmap(c) {
    this.add(`configmap/${c.name}`, 0);
  }

  finish() {
    return [...this.lines, `total ${this.total}`];
  }
}

class SecurityAudit extends Visitor {
  deployment(d) {
    if (d.privileged) this.lines.push(`deployment/${d.name}: privileged`);
  }

  service(s) {
    if (s.public) this.lines.push(`service/${s.name}: public`);
  }

  configmap(c) {
    if (c.secrets > 0)
      this.lines.push(`configmap/${c.name}: plain-text secrets`);
  }
}

const VISITORS = new Map([
  ["inventory", () => new Inventory()],
  ["lint", () => new Lint()],
  ["cost", () => new Cost()],
]);

// Per kind: each field with its least and greatest value, and whether it is required.
const field = (low, high, required = false) => ({ low, high, required });
const FLAG = field(0, 1);
const KINDS = new Map([
  [
    "deployment",
    {
      make: (n, f) => new Deployment(n, f),
      fields: new Map([
        ["replicas", field(0, MOST, true)],
        ["cpu", field(1, MOST)],
        ["memory", field(1, MOST)],
        ["privileged", FLAG],
      ]),
    },
  ],
  [
    "service",
    {
      make: (n, f) => new Service(n, f),
      fields: new Map([
        ["port", field(1, 65535, true)],
        ["public", FLAG],
      ]),
    },
  ],
  [
    "configmap",
    {
      make: (n, f) => new ConfigMap(n, f),
      fields: new Map([
        ["entries", field(0, MOST, true)],
        ["secrets", field(0, MOST)],
      ]),
    },
  ],
]);

class ManifestSet {
  constructor() {
    this.items = [];
    this.names = new Map();
  }

  addResource(kind, name, fields) {
    const spec = KINDS.get(kind);
    if (spec === undefined || name === "")
      throw new Error("unknown kind or empty name");
    for (const [key, value] of Object.entries(fields)) {
      const allowed = spec.fields.get(key);
      if (allowed === undefined) throw new Error("unknown field");
      if (value < allowed.low || value > allowed.high)
        throw new Error("value out of range");
    }
    for (const [key, allowed] of spec.fields)
      if (allowed.required && !(key in fields))
        throw new Error("missing field");
    const taken = this.names.get(kind) ?? new Set();
    if (taken.has(name)) return false;
    taken.add(name);
    this.names.set(kind, taken);
    this.items.push(spec.make(name, fields));
    return true;
  }

  runVisitor(visitor) {
    const make = VISITORS.get(visitor);
    if (make === undefined) throw new Error("unknown visitor");
    return this.walk(make());
  }

  kinds() {
    return [...this.names.keys()].sort(byCode);
  }

  // The extension round: a fourth operation, and no manifest class changes.
  securityAudit() {
    return this.walk(new SecurityAudit());
  }

  walk(v) {
    for (const item of this.items) item.accept(v);
    return v.finish();
  }
}

module.exports = { ManifestSet };
