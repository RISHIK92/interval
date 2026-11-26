"use strict";

// A subscriber: it keeps a local cache and drops a key when it hears it changed.
class AppNode {
  constructor() {
    this.cache = new Map();
    // The bus version when it went offline, or null while it is online.
    this.downAt = null;
    this.prefixes = []; // none means it hears every key
  }

  hears(key) {
    return (
      this.prefixes.length === 0 || this.prefixes.some((p) => key.startsWith(p))
    );
  }

  invalidate(key) {
    this.cache.delete(key);
  }
}

// The publisher: every write is numbered and announced to the nodes online.
class InvalidationBus {
  constructor() {
    this.nodes = new Map();
    this.log = []; // the key of each write, version 1 first
  }

  join(node) {
    if (node === "" || this.nodes.has(node)) throw new Error("empty or joined");
    this.nodes.set(node, new AppNode());
  }

  cacheLocal(node, key, val) {
    const n = this.serving(node);
    if (key === "" || val === "" || !n.hears(key))
      throw new Error("empty or outside the keyspace");
    n.cache.set(key, val);
  }

  write(key) {
    if (key === "") throw new Error("empty key");
    this.log.push(key);
    // A node never caches a key outside its keyspace, so dropping it there is moot.
    for (const n of this.nodes.values())
      if (n.downAt === null) n.invalidate(key);
    return this.log.length;
  }

  cached(node, key) {
    const n = this.serving(node);
    if (key === "") throw new Error("empty key");
    return n.cache.get(key) ?? null;
  }

  offline(node, down) {
    const n = this.find(node);
    if (n.downAt === null) {
      if (down) n.downAt = this.log.length;
      return;
    }
    if (down) return;
    // It can't know which keys changed while it was away, only that some did.
    if (this.log.slice(n.downAt).some((key) => n.hears(key))) n.cache.clear();
    n.downAt = null;
  }

  // The extension round: a node hears only the keys under its prefixes.
  keyspace(node, prefix) {
    const n = this.find(node);
    if (prefix === "") throw new Error("empty prefix");
    if (!n.prefixes.includes(prefix)) n.prefixes.push(prefix);
    const outside = [...n.cache.keys()].filter((key) => !n.hears(key));
    for (const key of outside) n.cache.delete(key);
    return outside.length;
  }

  find(node) {
    const n = this.nodes.get(node);
    if (n === undefined) throw new Error("unknown node");
    return n;
  }

  serving(node) {
    const n = this.find(node);
    if (n.downAt !== null) throw new Error("the node is offline");
    return n;
  }
}

module.exports = { InvalidationBus };
