const LOAD_BALANCER = 20;
const MOST = 1_000_000;
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

class Deployment {
  readonly name: string;
  readonly replicas: number;
  readonly cpu: number | undefined;
  readonly memory: number | undefined;
  readonly privileged: boolean;

  constructor(name: string, f: Record<string, number>) {
    this.name = name;
    this.replicas = f.replicas ?? 0;
    this.cpu = f.cpu;
    this.memory = f.memory;
    this.privileged = f.privileged === 1;
  }

  accept(v: Visitor): void {
    v.deployment(this);
  }
}

class Service {
  readonly name: string;
  readonly port: number;
  readonly public: boolean;

  constructor(name: string, f: Record<string, number>) {
    this.name = name;
    this.port = f.port ?? 0;
    this.public = f.public === 1;
  }

  accept(v: Visitor): void {
    v.service(this);
  }
}

class ConfigMap {
  readonly name: string;
  readonly entries: number;
  readonly secrets: number;

  constructor(name: string, f: Record<string, number>) {
    this.name = name;
    this.entries = f.entries ?? 0;
    this.secrets = f.secrets ?? 0;
  }

  accept(v: Visitor): void {
    v.configmap(this);
  }
}

type Manifest = Deployment | Service | ConfigMap;

// One operation over every kind. A new operation is a new visitor; the manifest classes
// above never change for it.
abstract class Visitor {
  protected readonly lines: string[] = [];
  abstract deployment(d: Deployment): void;
  abstract service(s: Service): void;
  abstract configmap(c: ConfigMap): void;

  finish(): string[] {
    return this.lines;
  }
}

class Inventory extends Visitor {
  deployment(d: Deployment): void {
    this.lines.push(`deployment/${d.name} replicas=${String(d.replicas)}`);
  }

  service(s: Service): void {
    this.lines.push(`service/${s.name} port=${String(s.port)}`);
  }

  configmap(c: ConfigMap): void {
    this.lines.push(`configmap/${c.name} entries=${String(c.entries)}`);
  }
}

class Lint extends Visitor {
  deployment(d: Deployment): void {
    if (d.replicas === 1)
      this.lines.push(`deployment/${d.name}: single replica`);
    if (d.cpu === undefined)
      this.lines.push(`deployment/${d.name}: no cpu limit`);
  }

  service(): void {
    // Nothing about a service is linted yet.
  }

  configmap(c: ConfigMap): void {
    if (c.entries === 0) this.lines.push(`configmap/${c.name}: empty`);
  }
}

class Cost extends Visitor {
  private total = 0;

  private add(what: string, cost: number): void {
    this.lines.push(`${what} ${String(cost)}`);
    this.total += cost;
  }

  deployment(d: Deployment): void {
    this.add(
      `deployment/${d.name}`,
      d.replicas * ((d.cpu ?? 0) + (d.memory ?? 0)),
    );
  }

  service(s: Service): void {
    this.add(`service/${s.name}`, s.public ? LOAD_BALANCER : 0);
  }

  configmap(c: ConfigMap): void {
    this.add(`configmap/${c.name}`, 0);
  }

  finish(): string[] {
    return [...this.lines, `total ${String(this.total)}`];
  }
}

class SecurityAudit extends Visitor {
  deployment(d: Deployment): void {
    if (d.privileged) this.lines.push(`deployment/${d.name}: privileged`);
  }

  service(s: Service): void {
    if (s.public) this.lines.push(`service/${s.name}: public`);
  }

  configmap(c: ConfigMap): void {
    if (c.secrets > 0)
      this.lines.push(`configmap/${c.name}: plain-text secrets`);
  }
}

const VISITORS = new Map<string, () => Visitor>([
  ["inventory", () => new Inventory()],
  ["lint", () => new Lint()],
  ["cost", () => new Cost()],
]);

// Per kind: each field with its least and greatest value, and whether it is required.
interface Field {
  low: number;
  high: number;
  required: boolean;
}
const field = (low: number, high: number, required = false): Field => ({
  low,
  high,
  required,
});
const FLAG = field(0, 1);
const KINDS = new Map<
  string,
  {
    make: (name: string, f: Record<string, number>) => Manifest;
    fields: Map<string, Field>;
  }
>([
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

export class ManifestSet {
  private readonly items: Manifest[] = [];
  private readonly names = new Map<string, Set<string>>();

  addResource(
    kind: string,
    name: string,
    fields: Record<string, number>,
  ): boolean {
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
    const taken = this.names.get(kind) ?? new Set<string>();
    if (taken.has(name)) return false;
    taken.add(name);
    this.names.set(kind, taken);
    this.items.push(spec.make(name, fields));
    return true;
  }

  runVisitor(visitor: string): string[] {
    const make = VISITORS.get(visitor);
    if (make === undefined) throw new Error("unknown visitor");
    return this.walk(make());
  }

  kinds(): string[] {
    return [...this.names.keys()].sort(byCode);
  }

  // The extension round: a fourth operation, and no manifest class changes.
  securityAudit(): string[] {
    return this.walk(new SecurityAudit());
  }

  private walk(v: Visitor): string[] {
    for (const item of this.items) item.accept(v);
    return v.finish();
  }
}
