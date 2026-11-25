"use strict";

function named(...names) {
  if (names.includes("")) throw new RangeError("package names are not empty");
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Each package keeps the packages it uses, in declared order, and the reverse links to
// its dependents. Dependencies must already exist, so the graph never has a cycle.
class PackageGraph {
  #deps = new Map();
  #dependents = new Map();
  #pinned = new Set();

  #known(pkg) {
    named(pkg);
    if (!this.#deps.has(pkg)) throw new RangeError("unknown package");
  }

  add(pkg, deps) {
    named(pkg, ...deps);
    if (new Set(deps).size !== deps.length)
      throw new RangeError("a dependency is listed twice");
    if (this.#deps.has(pkg) || deps.some((d) => !this.#deps.has(d)))
      return false;
    this.#deps.set(pkg, [...deps]);
    this.#dependents.set(pkg, new Set());
    for (const d of deps) this.#dependents.get(d).add(pkg);
    return true;
  }

  remove(pkg) {
    named(pkg);
    const users = this.#dependents.get(pkg);
    if (users === undefined || users.size > 0) return false;
    for (const d of this.#deps.get(pkg)) this.#dependents.get(d).delete(pkg);
    this.#deps.delete(pkg);
    this.#dependents.delete(pkg);
    this.#pinned.delete(pkg);
    return true;
  }

  dependents(pkg) {
    this.#known(pkg);
    return [...this.#dependents.get(pkg)].sort(byCode);
  }

  installOrder(pkg) {
    this.#known(pkg);
    const order = [];
    const listed = new Set();
    const visit = (p) => {
      if (listed.has(p)) return;
      for (const d of this.#deps.get(p)) visit(d);
      listed.add(p);
      order.push(p);
    };
    visit(pkg);
    return order;
  }

  // The extension round: pinned packages are never unused.
  pin(pkg) {
    this.#known(pkg);
    this.#pinned.add(pkg);
  }

  unused() {
    return [...this.#dependents]
      .filter(([p, users]) => users.size === 0 && !this.#pinned.has(p))
      .map(([p]) => p)
      .sort(byCode);
  }
}

module.exports = { PackageGraph };
