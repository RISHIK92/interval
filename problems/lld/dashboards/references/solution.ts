function named(...names: string[]): void {
  if (names.includes(""))
    throw new RangeError("names and expressions are not empty");
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Queries are aggregated: panels hold only a query's name, and a query outlives every
// dashboard. Panels are composed: they live inside their dashboard's map.
export class Dashboards {
  private readonly queries = new Map<string, string>();
  private readonly dashboards = new Map<string, Map<string, string>>();

  private panels(dashboard: string): Map<string, string> {
    named(dashboard);
    const panels = this.dashboards.get(dashboard);
    if (panels === undefined) throw new RangeError("unknown dashboard");
    return panels;
  }

  saveQuery(name: string, expr: string): void {
    named(name, expr);
    if (this.queries.has(name)) throw new RangeError("query already saved");
    this.queries.set(name, expr);
  }

  addPanel(dashboard: string, panel: string, query: string): boolean {
    named(dashboard, panel, query);
    if (!this.queries.has(query)) return false;
    const panels = this.dashboards.get(dashboard) ?? new Map<string, string>();
    if (panels.has(panel)) return false;
    panels.set(panel, query);
    this.dashboards.set(dashboard, panels);
    return true;
  }

  dropDashboard(dashboard: string): number {
    const panels = this.panels(dashboard);
    this.dashboards.delete(dashboard);
    return panels.size;
  }

  dropQuery(name: string): boolean {
    named(name);
    if (!this.queries.has(name) || this.usage(name).length > 0) return false;
    this.queries.delete(name);
    return true;
  }

  usage(query: string): string[] {
    named(query);
    if (!this.queries.has(query)) throw new RangeError("unknown query");
    const out: string[] = [];
    for (const [dashboard, panels] of this.dashboards)
      for (const [panel, used] of panels)
        if (used === query) out.push(`${dashboard}/${panel}`);
    return out.sort(byCode);
  }

  // The extension round: a copy owns new panels that share the same queries.
  duplicate(dashboard: string, newName: string): boolean {
    const panels = this.panels(dashboard);
    named(newName);
    if (this.dashboards.has(newName)) return false;
    this.dashboards.set(newName, new Map(panels));
    return true;
  }
}
