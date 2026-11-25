const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// A component: a rule (a leaf) or a group (a composite). Callers evaluate, count and mute
// either the same way, without asking which one they hold.
abstract class AlertNode {
  readonly name: string;
  parent: Group | null;
  muted = false;

  constructor(name: string, parent: Group | null) {
    this.name = name;
    this.parent = parent;
  }

  path(): string {
    if (this.parent === null) return "/";
    const above = this.parent.path();
    return above === "/" ? `/${this.name}` : `${above}/${this.name}`;
  }

  // Adds the paths of this node's unmuted rules that fire.
  abstract firing(metrics: ReadonlyMap<string, number>, out: string[]): void;
  abstract count(): number;
}

class Rule extends AlertNode {
  private readonly metric: string;
  private readonly threshold: number;

  constructor(name: string, parent: Group, metric: string, threshold: number) {
    super(name, parent);
    this.metric = metric;
    this.threshold = threshold;
  }

  firing(metrics: ReadonlyMap<string, number>, out: string[]): void {
    const value = metrics.get(this.metric);
    if (!this.muted && value !== undefined && value > this.threshold)
      out.push(this.path());
  }

  count(): number {
    return 1;
  }
}

class Group extends AlertNode {
  readonly children = new Map<string, AlertNode>();

  firing(metrics: ReadonlyMap<string, number>, out: string[]): void {
    // A muted group silences everything under it, whatever their own flags say.
    if (!this.muted)
      for (const child of this.children.values()) child.firing(metrics, out);
  }

  count(): number {
    let total = 0;
    for (const child of this.children.values()) total += child.count();
    return total;
  }
}

function checkName(name: string): void {
  if (name === "" || name.includes("/"))
    throw new RangeError("a name is non-empty and has no slash");
}

export class AlertTree {
  private readonly root = new Group("", null);

  group(parent: string, name: string): boolean {
    const at = this.groupAt(parent);
    checkName(name);
    return this.attach(at, name, () => new Group(name, at));
  }

  rule(
    parent: string,
    name: string,
    metric: string,
    threshold: number,
  ): boolean {
    const at = this.groupAt(parent);
    checkName(name);
    if (metric === "") throw new RangeError("empty metric");
    return this.attach(at, name, () => new Rule(name, at, metric, threshold));
  }

  mute(node: string, on: boolean): boolean {
    const found = this.find(node);
    if (found.muted === on) return false;
    found.muted = on;
    return true;
  }

  firing(metrics: Record<string, number>): string[] {
    const out: string[] = [];
    this.root.firing(new Map(Object.entries(metrics)), out);
    return out.sort(byCode);
  }

  count(node: string): number {
    return this.find(node).count();
  }

  // The extension round: moving a subtree, with its mutes.
  moveNode(node: string, parent: string): boolean {
    const moving = this.find(node);
    const to = this.groupAt(parent);
    const from = moving.parent;
    if (from === null) throw new RangeError("the root stays where it is");
    // A group can't go under itself or anything below it: that would cut it off.
    const inside = `${to.path()}/`.startsWith(`${moving.path()}/`);
    if (inside || to.children.has(moving.name)) return false;
    from.children.delete(moving.name);
    moving.parent = to;
    to.children.set(moving.name, moving);
    return true;
  }

  private attach(at: Group, name: string, make: () => AlertNode): boolean {
    if (at.children.has(name)) return false;
    at.children.set(name, make());
    return true;
  }

  private find(path: string): AlertNode {
    if (path === "/") return this.root;
    if (!path.startsWith("/"))
      throw new RangeError("a path starts with a slash");
    let at: AlertNode = this.root;
    for (const part of path.slice(1).split("/")) {
      const next = at instanceof Group ? at.children.get(part) : undefined;
      if (next === undefined) throw new RangeError("no such node");
      at = next;
    }
    return at;
  }

  private groupAt(path: string): Group {
    const found = this.find(path);
    if (!(found instanceof Group))
      throw new RangeError("a rule has no children");
    return found;
  }
}
