const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

// A component: a service (a leaf) or a unit (a composite). Anyone asking for a total asks
// the node, whichever it is.
abstract class CostNode {
  readonly name: string;
  parent: Unit | null;
  shared = 0; // cents allocated to this node from above (the extension)

  constructor(name: string, parent: Unit | null) {
    this.name = name;
    this.parent = parent;
  }

  abstract total(): number;
  abstract children(): CostNode[];
}

class Service extends CostNode {
  private readonly cents: number;

  constructor(name: string, parent: Unit, cents: number) {
    super(name, parent);
    this.cents = cents;
  }

  total(): number {
    return this.cents + this.shared;
  }

  children(): CostNode[] {
    return [];
  }
}

class Unit extends CostNode {
  readonly members = new Map<string, CostNode>();

  total(): number {
    let sum = this.shared;
    for (const child of this.members.values()) sum += child.total();
    return sum;
  }

  children(): CostNode[] {
    return [...this.members.values()];
  }

  // Whether this unit is node itself or somewhere under it.
  within(node: CostNode): boolean {
    return this === node || (this.parent?.within(node) ?? false);
  }
}

export class CostTree {
  private readonly nodes = new Map<string, CostNode>();

  constructor(root: string) {
    given(root);
    this.nodes.set(root, new Unit(root, null));
  }

  unit(parent: string, name: string): boolean {
    const at = this.unitAt(parent);
    given(name);
    return this.attach(at, new Unit(name, at));
  }

  service(parent: string, name: string, cents: number): boolean {
    const at = this.unitAt(parent);
    given(name);
    if (cents < 0) throw new RangeError("a cost is never negative");
    return this.attach(at, new Service(name, at, cents));
  }

  total(node: string): number {
    return this.find(node).total();
  }

  move(node: string, parent: string): boolean {
    const moving = this.find(node);
    const to = this.unitAt(parent);
    const from = moving.parent;
    if (from === null) throw new RangeError("the root stays where it is");
    if (from === to || to.within(moving)) return false;
    from.members.delete(moving.name);
    moving.parent = to;
    to.members.set(moving.name, moving);
    return true;
  }

  top(node: string, n: number): string[] {
    const found = this.find(node);
    if (n < 0) throw new RangeError("n is never negative");
    return found
      .children()
      .map((child) => ({ name: child.name, total: child.total() }))
      .sort((a, b) => b.total - a.total || byCode(a.name, b.name))
      .slice(0, n)
      .map((child) => `${child.name} ${child.total}`);
  }

  // The extension round: a cost shared by everything directly under a unit.
  sharedCost(node: string, cents: number): void {
    const found = this.unitAt(node);
    if (cents < 0) throw new RangeError("a cost is never negative");
    const children = found.children().sort((a, b) => byCode(a.name, b.name));
    if (children.length === 0) throw new RangeError("nothing to share with");
    const each = Math.floor(cents / children.length);
    const extra = cents % children.length;
    children.forEach((child, i) => {
      child.shared += each + (i < extra ? 1 : 0);
    });
  }

  private attach(at: Unit, node: CostNode): boolean {
    if (this.nodes.has(node.name)) return false;
    at.members.set(node.name, node);
    this.nodes.set(node.name, node);
    return true;
  }

  private find(name: string): CostNode {
    const found = this.nodes.get(name);
    if (found === undefined) throw new RangeError("no such node");
    return found;
  }

  private unitAt(name: string): Unit {
    const found = this.find(name);
    if (!(found instanceof Unit))
      throw new RangeError("a service has nothing under it");
    return found;
  }
}
