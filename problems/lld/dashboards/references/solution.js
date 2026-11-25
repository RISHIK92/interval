"use strict";

function named(...names) {
  if (names.includes(""))
    throw new RangeError("names and expressions are not empty");
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Queries are aggregated: panels hold only a query's name, and a query outlives every
// dashboard. Panels are composed: they live inside their dashboard's map.
class Dashboards {
  #queries = new Map();
  #dashboards = new Map();

  #panels(dashboard) {
    named(dashboard);
    const panels = this.#dashboards.get(dashboard);
    if (panels === undefined) throw new RangeError("unknown dashboard");
    return panels;
  }

  saveQuery(name, expr) {
    named(name, expr);
    if (this.#queries.has(name)) throw new RangeError("query already saved");
    this.#queries.set(name, expr);
  }

  addPanel(dashboard, panel, query) {
    named(dashboard, panel, query);
    if (!this.#queries.has(query)) return false;
    const panels = this.#dashboards.get(dashboard) ?? new Map();
    if (panels.has(panel)) return false;
    panels.set(panel, query);
    this.#dashboards.set(dashboard, panels);
    return true;
  }

  dropDashboard(dashboard) {
    const panels = this.#panels(dashboard);
    this.#dashboards.delete(dashboard);
    return panels.size;
  }

  dropQuery(name) {
    named(name);
    if (!this.#queries.has(name) || this.usage(name).length > 0) return false;
    this.#queries.delete(name);
    return true;
  }

  usage(query) {
    named(query);
    if (!this.#queries.has(query)) throw new RangeError("unknown query");
    const out = [];
    for (const [dashboard, panels] of this.#dashboards)
      for (const [panel, used] of panels)
        if (used === query) out.push(`${dashboard}/${panel}`);
    return out.sort(byCode);
  }

  // The extension round: a copy owns new panels that share the same queries.
  duplicate(dashboard, newName) {
    const panels = this.#panels(dashboard);
    named(newName);
    if (this.#dashboards.has(newName)) return false;
    this.#dashboards.set(newName, new Map(panels));
    return true;
  }
}

module.exports = { Dashboards };
