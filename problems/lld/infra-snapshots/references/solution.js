"use strict";

const copy = (resources) =>
  new Map([...resources].map(([name, attrs]) => [name, new Map(attrs)]));

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The memento: a frozen copy of the state that only InfraState reads back.
class Snapshot {
  constructor(label, resources) {
    this.label = label;
    this.saved = copy(resources);
  }

  resources() {
    return copy(this.saved);
  }
}

class InfraState {
  constructor() {
    this.current = new Map();
    // The caretaker's side: snapshots by id, known here only by their labels.
    this.snapshots = new Map();
    this.lastId = 0;
  }

  apply(resource, attrs) {
    const entries = Object.entries(attrs);
    if (resource === "" || entries.some(([k, v]) => k === "" || v === ""))
      throw new Error("empty name or value");
    this.current.set(resource, new Map(entries));
  }

  destroy(resource) {
    if (resource === "") throw new Error("empty resource");
    return this.current.delete(resource);
  }

  snapshot(label) {
    if (label === "") throw new Error("empty label");
    for (const [id, snap] of this.snapshots)
      if (snap.label === label) this.snapshots.delete(id);
    this.lastId += 1;
    this.snapshots.set(this.lastId, new Snapshot(label, this.current));
    return this.lastId;
  }

  restore(snapshotId) {
    const snap = this.snapshots.get(snapshotId);
    if (snap === undefined) return false;
    this.current = snap.resources();
    return true;
  }

  diffSince(snapshotId) {
    const snap = this.snapshots.get(snapshotId);
    if (snap === undefined) throw new Error("unknown snapshot");
    const then = snap.resources();
    const names = [...new Set([...then.keys(), ...this.current.keys()])].sort(
      byCode,
    );
    const out = [];
    for (const name of names) {
      const before = then.get(name);
      const now = this.current.get(name);
      if (before === undefined) out.push(`+ ${name}`);
      else if (now === undefined) out.push(`- ${name}`);
      else {
        const keys = [...new Set([...before.keys(), ...now.keys()])]
          .filter((k) => before.get(k) !== now.get(k))
          .sort(byCode);
        if (keys.length > 0) out.push(`~ ${name}: ${keys.join(",")}`);
      }
    }
    return out;
  }

  // The extension round: keeping only the newest snapshots.
  prune(keep) {
    if (keep < 0) throw new Error("negative keep");
    const ids = [...this.snapshots.keys()].sort((a, b) => a - b);
    const dropped = ids.slice(0, Math.max(ids.length - keep, 0));
    for (const id of dropped) this.snapshots.delete(id);
    return dropped.length;
  }
}

module.exports = { InfraState };
