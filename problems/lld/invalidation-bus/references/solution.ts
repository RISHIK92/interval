// A subscriber: it keeps a local cache and drops a key when it hears it changed.
class AppNode {
  readonly cache = new Map<string, string>();
  // The bus version when it went offline, or null while it is online.
  downAt: number | null = null;
  readonly prefixes: string[] = []; // none means it hears every key

  hears(key: string): boolean {
    return (
      this.prefixes.length === 0 || this.prefixes.some((p) => key.startsWith(p))
    );
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }
}

// The publisher: every write is numbered and announced to the nodes online.
export class InvalidationBus {
  private readonly nodes = new Map<string, AppNode>();
  private readonly log: string[] = []; // the key of each write, version 1 first

  join(node: string): void {
    if (node === "" || this.nodes.has(node)) throw new Error("empty or joined");
    this.nodes.set(node, new AppNode());
  }

  cacheLocal(node: string, key: string, val: string): void {
    const n = this.serving(node);
    if (key === "" || val === "" || !n.hears(key))
      throw new Error("empty or outside the keyspace");
    n.cache.set(key, val);
  }

  write(key: string): number {
    if (key === "") throw new Error("empty key");
    this.log.push(key);
    // A node never caches a key outside its keyspace, so dropping it there is moot.
    for (const n of this.nodes.values())
      if (n.downAt === null) n.invalidate(key);
    return this.log.length;
  }

  cached(node: string, key: string): string | null {
    const n = this.serving(node);
    if (key === "") throw new Error("empty key");
    return n.cache.get(key) ?? null;
  }

  offline(node: string, down: boolean): void {
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
  keyspace(node: string, prefix: string): number {
    const n = this.find(node);
    if (prefix === "") throw new Error("empty prefix");
    if (!n.prefixes.includes(prefix)) n.prefixes.push(prefix);
    const outside = [...n.cache.keys()].filter((key) => !n.hears(key));
    for (const key of outside) n.cache.delete(key);
    return outside.length;
  }

  private find(node: string): AppNode {
    const n = this.nodes.get(node);
    if (n === undefined) throw new Error("unknown node");
    return n;
  }

  private serving(node: string): AppNode {
    const n = this.find(node);
    if (n.downAt !== null) throw new Error("the node is offline");
    return n;
  }
}
