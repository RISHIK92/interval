function named(name: string): void {
  if (name === "") throw new RangeError("names are not empty");
}

// Each person knows their manager, and each manager knows their direct reports; the two
// sides change together. The root is the one person with no manager.
export class OrgChart {
  private root: string;
  private readonly manager = new Map<string, string | null>();
  private readonly reports = new Map<string, Set<string>>();

  constructor(ceo: string) {
    named(ceo);
    this.root = ceo;
    this.manager.set(ceo, null);
    this.reports.set(ceo, new Set());
  }

  private link(name: string, manager: string | null): void {
    this.manager.set(name, manager);
    if (manager !== null) this.reports.get(manager)?.add(name);
  }

  private unlink(name: string): void {
    const manager = this.manager.get(name);
    if (manager !== undefined && manager !== null)
      this.reports.get(manager)?.delete(name);
  }

  hire(name: string, manager: string): boolean {
    named(name);
    named(manager);
    if (this.manager.has(name) || !this.manager.has(manager)) return false;
    this.reports.set(name, new Set());
    this.link(name, manager);
    return true;
  }

  reassign(name: string, manager: string): boolean {
    named(name);
    named(manager);
    if (
      !this.manager.has(name) ||
      !this.manager.has(manager) ||
      name === this.root
    )
      return false;
    if (this.chain(manager).includes(name)) return false;
    this.unlink(name);
    this.link(name, manager);
    return true;
  }

  leave(name: string): boolean {
    named(name);
    const up = this.manager.get(name);
    if (up === undefined || name === this.root) return false;
    this.unlink(name);
    const reports = this.reports.get(name) ?? new Set<string>();
    this.reports.delete(name);
    for (const report of reports) this.link(report, up);
    this.manager.delete(name);
    return true;
  }

  chain(name: string): string[] {
    named(name);
    if (!this.manager.has(name)) throw new RangeError("unknown person");
    const out: string[] = [];
    for (
      let at: string | null = name;
      at !== null;
      at = this.manager.get(at) ?? null
    )
      out.push(at);
    return out;
  }

  span(manager: string): number {
    named(manager);
    const reports = this.reports.get(manager);
    if (reports === undefined) throw new RangeError("unknown person");
    return reports.size;
  }

  // The extension round: a person swaps places with their manager.
  promote(name: string): boolean {
    named(name);
    const boss = this.manager.get(name);
    if (boss === undefined || boss === null) return false;
    const above = this.manager.get(boss) ?? null;
    const theirs = [...(this.reports.get(boss) ?? [])].filter(
      (r) => r !== name,
    );
    const mine = [...(this.reports.get(name) ?? [])];
    this.unlink(boss);
    this.link(name, above);
    this.reports.set(name, new Set());
    this.reports.set(boss, new Set());
    this.link(boss, name);
    for (const report of theirs) this.link(report, name);
    for (const report of mine) this.link(report, boss);
    if (boss === this.root) this.root = name;
    return true;
  }
}
