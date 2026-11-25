function named(...names: string[]): void {
  if (names.includes("")) throw new RangeError("package names are not empty");
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Each package keeps the packages it uses, in declared order, and the reverse links to
// its dependents. Dependencies must already exist, so the graph never has a cycle.
export class PackageGraph {
  private readonly deps = new Map<string, string[]>();
  private readonly users = new Map<string, Set<string>>();
  private readonly pinned = new Set<string>();

  private usersOf(pkg: string): Set<string> {
    named(pkg);
    const found = this.users.get(pkg);
    if (found === undefined) throw new RangeError("unknown package");
    return found;
  }

  add(pkg: string, deps: string[]): boolean {
    named(pkg, ...deps);
    if (new Set(deps).size !== deps.length)
      throw new RangeError("a dependency is listed twice");
    if (this.deps.has(pkg) || deps.some((d) => !this.deps.has(d))) return false;
    this.deps.set(pkg, [...deps]);
    this.users.set(pkg, new Set());
    for (const d of deps) this.users.get(d)?.add(pkg);
    return true;
  }

  remove(pkg: string): boolean {
    named(pkg);
    const found = this.users.get(pkg);
    if (found === undefined || found.size > 0) return false;
    for (const d of this.deps.get(pkg) ?? []) this.users.get(d)?.delete(pkg);
    this.deps.delete(pkg);
    this.users.delete(pkg);
    this.pinned.delete(pkg);
    return true;
  }

  dependents(pkg: string): string[] {
    return [...this.usersOf(pkg)].sort(byCode);
  }

  installOrder(pkg: string): string[] {
    this.usersOf(pkg);
    const order: string[] = [];
    const listed = new Set<string>();
    const visit = (p: string): void => {
      if (listed.has(p)) return;
      for (const d of this.deps.get(p) ?? []) visit(d);
      listed.add(p);
      order.push(p);
    };
    visit(pkg);
    return order;
  }

  // The extension round: pinned packages are never unused.
  pin(pkg: string): void {
    this.usersOf(pkg);
    this.pinned.add(pkg);
  }

  unused(): string[] {
    return [...this.users]
      .filter(([p, found]) => found.size === 0 && !this.pinned.has(p))
      .map(([p]) => p)
      .sort(byCode);
  }
}
