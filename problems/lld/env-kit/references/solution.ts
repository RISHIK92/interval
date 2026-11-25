// An abstract factory: one family's way of making each kind of component. The kit only
// ever asks the family in use, so every component it makes belongs together.
interface Family {
  readonly name: string;
  queue(): string;
  store(): string;
  clock(): string;
}

class Local implements Family {
  readonly name = "local";
  queue(): string {
    return "inmem-queue";
  }
  store(): string {
    return "sqlite-store";
  }
  clock(): string {
    return "fake-clock";
  }
}

class Ci implements Family {
  readonly name = "ci";
  queue(): string {
    return "valkey-queue";
  }
  store(): string {
    return "postgres-store";
  }
  clock(): string {
    return "fixed-clock";
  }
}

class Staging implements Family {
  readonly name = "staging";
  queue(): string {
    return "sqs-queue";
  }
  store(): string {
    return "rds-store";
  }
  clock(): string {
    return "system-clock";
  }
}

// A family defined at run time: its components are named after its prefix.
class Prefixed implements Family {
  readonly name: string;
  private readonly prefix: string;

  constructor(name: string, prefix: string) {
    this.name = name;
    this.prefix = prefix;
  }
  queue(): string {
    return `${this.prefix}-queue`;
  }
  store(): string {
    return `${this.prefix}-store`;
  }
  clock(): string {
    return `${this.prefix}-clock`;
  }
}

// Each kind is one of the factory's methods; the kit never names a concrete family.
const KINDS = new Map<string, (f: Family) => string>([
  ["queue", (f) => f.queue()],
  ["store", (f) => f.store()],
  ["clock", (f) => f.clock()],
]);

export class EnvKit {
  private readonly families = new Map<string, Family>(
    [new Local(), new Ci(), new Staging()].map((f) => [f.name, f]),
  );
  private current: Family | null = null;
  private readonly made = new Map<string, string>(); // component id -> family name

  use(family: string): void {
    const found = this.families.get(family);
    if (found === undefined) throw new RangeError("unknown family");
    this.current = found;
  }

  component(kind: string): string {
    const make = KINDS.get(kind);
    if (make === undefined) throw new RangeError("unknown kind");
    if (this.current === null) throw new RangeError("no family in use");
    const made = `${make(this.current)}#${String(this.made.size + 1)}`;
    this.made.set(made, this.current.name);
    return made;
  }

  wire(a: string, b: string): boolean {
    if (a === b) throw new RangeError("a component can't be wired to itself");
    return this.family(a) === this.family(b);
  }

  family(componentId: string): string {
    const found = this.made.get(componentId);
    if (found === undefined) throw new RangeError("unknown component");
    return found;
  }

  // The extension round: a family that isn't built in.
  defineFamily(name: string, prefix: string): void {
    if (name === "" || prefix === "") throw new RangeError("empty");
    if (this.families.has(name)) throw new RangeError("family exists");
    this.families.set(name, new Prefixed(name, prefix));
  }
}
