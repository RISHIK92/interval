"use strict";

function named(name) {
  if (name === "") throw new RangeError("names are not empty");
}

// Each person knows their manager, and each manager knows their direct reports; the two
// sides change together. The root is the one person with no manager.
class OrgChart {
  #root;
  #manager = new Map();
  #reports = new Map();

  constructor(ceo) {
    named(ceo);
    this.#root = ceo;
    this.#manager.set(ceo, null);
    this.#reports.set(ceo, new Set());
  }

  #link(name, manager) {
    this.#manager.set(name, manager);
    if (manager !== null) this.#reports.get(manager).add(name);
  }

  #unlink(name) {
    const manager = this.#manager.get(name);
    if (manager !== null) this.#reports.get(manager).delete(name);
  }

  hire(name, manager) {
    named(name);
    named(manager);
    if (this.#manager.has(name) || !this.#manager.has(manager)) return false;
    this.#reports.set(name, new Set());
    this.#link(name, manager);
    return true;
  }

  reassign(name, manager) {
    named(name);
    named(manager);
    if (
      !this.#manager.has(name) ||
      !this.#manager.has(manager) ||
      name === this.#root
    )
      return false;
    if (this.chain(manager).includes(name)) return false;
    this.#unlink(name);
    this.#link(name, manager);
    return true;
  }

  leave(name) {
    named(name);
    if (!this.#manager.has(name) || name === this.#root) return false;
    const up = this.#manager.get(name);
    this.#unlink(name);
    const reports = this.#reports.get(name);
    this.#reports.delete(name);
    for (const report of reports) this.#link(report, up);
    this.#manager.delete(name);
    return true;
  }

  chain(name) {
    named(name);
    if (!this.#manager.has(name)) throw new RangeError("unknown person");
    const out = [];
    for (let at = name; at !== null; at = this.#manager.get(at)) out.push(at);
    return out;
  }

  span(manager) {
    named(manager);
    const reports = this.#reports.get(manager);
    if (reports === undefined) throw new RangeError("unknown person");
    return reports.size;
  }

  // The extension round: a person swaps places with their manager.
  promote(name) {
    named(name);
    if (!this.#manager.has(name) || name === this.#root) return false;
    const boss = this.#manager.get(name);
    const above = this.#manager.get(boss);
    const theirs = [...this.#reports.get(boss)].filter((r) => r !== name);
    const mine = [...this.#reports.get(name)];
    this.#unlink(boss);
    this.#link(name, above);
    this.#reports.set(name, new Set());
    this.#reports.set(boss, new Set());
    this.#link(boss, name);
    for (const report of theirs) this.#link(report, name);
    for (const report of mine) this.#link(report, boss);
    if (boss === this.#root) this.#root = name;
    return true;
  }
}

module.exports = { OrgChart };
