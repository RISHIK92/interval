// A directory is a Map of name to node, a file is its text.
type Node = string | Map<string, Node>;

export class FileSystem {
  private readonly root = new Map<string, Node>();

  private parts(path: string): string[] {
    if (!path.startsWith("/")) throw new RangeError("invalid path");
    const out: string[] = [];
    for (const s of path.split("/")) {
      if (s === "" || s === ".") continue;
      if (s === "..") {
        if (out.length === 0) throw new RangeError("invalid path");
        out.pop();
      } else out.push(s);
    }
    return out;
  }

  private walk(parts: string[]): Node {
    let node: Node = this.root;
    for (const p of parts) {
      if (typeof node === "string") throw new Error("not a directory");
      const next: Node | undefined = node.get(p);
      if (next === undefined) throw new Error("not found");
      node = next;
    }
    return node;
  }

  private parent(parts: string[]): [Map<string, Node>, string] {
    const name = parts[parts.length - 1];
    if (name === undefined) throw new Error("is a directory");
    const parent = this.walk(parts.slice(0, -1));
    if (typeof parent === "string") throw new Error("not a directory");
    return [parent, name];
  }

  mkdir(path: string): void {
    let node: Map<string, Node> = this.root;
    for (const p of this.parts(path)) {
      let next = node.get(p);
      if (next === undefined) {
        next = new Map<string, Node>();
        node.set(p, next);
      } else if (typeof next === "string") throw new Error("already exists");
      node = next;
    }
  }

  write(path: string, text: string): void {
    const [parent, name] = this.parent(this.parts(path));
    if (parent.get(name) instanceof Map) throw new Error("is a directory");
    parent.set(name, text);
  }

  appendTo(path: string, text: string): void {
    const [parent, name] = this.parent(this.parts(path));
    const old = parent.get(name);
    if (old instanceof Map) throw new Error("is a directory");
    parent.set(name, (old ?? "") + text);
  }

  read(path: string): string {
    const node = this.walk(this.parts(path));
    if (typeof node !== "string") throw new Error("is a directory");
    return node;
  }

  ls(path: string): string[] {
    const parts = this.parts(path);
    const node = this.walk(parts);
    return typeof node === "string"
      ? [parts[parts.length - 1] ?? ""]
      : [...node.keys()].sort();
  }

  rm(path: string): void {
    const [parent, name] = this.parent(this.parts(path));
    const node = parent.get(name);
    if (node === undefined) throw new Error("not found");
    if (typeof node !== "string" && node.size > 0)
      throw new Error("directory not empty");
    parent.delete(name);
  }

  // The extension round.
  mv(source: string, target: string): void {
    const sp = this.parts(source);
    const tp = this.parts(target);
    if (sp.length === 0) throw new RangeError("cannot move the root");
    const node = this.walk(sp);
    if (sp.every((p, i) => tp[i] === p))
      throw new RangeError("cannot move into itself");
    const [tparent, tname] = this.parent(tp);
    if (tparent.has(tname)) throw new Error("already exists");
    const [sparent, sname] = this.parent(sp);
    sparent.delete(sname);
    tparent.set(tname, node);
  }

  size(path: string): number {
    const total = (node: Node): number =>
      typeof node === "string"
        ? node.length
        : [...node.values()].reduce((sum, n) => sum + total(n), 0);
    return total(this.walk(this.parts(path)));
  }
}
