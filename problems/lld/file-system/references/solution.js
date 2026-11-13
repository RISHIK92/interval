"use strict";

// A directory is a Map of name to node, a file is its text.
class FileSystem {
  constructor() {
    this.root = new Map();
  }

  parts(path) {
    if (!path.startsWith("/")) throw new RangeError("invalid path");
    const out = [];
    for (const s of path.split("/")) {
      if (s === "" || s === ".") continue;
      if (s === "..") {
        if (out.length === 0) throw new RangeError("invalid path");
        out.pop();
      } else out.push(s);
    }
    return out;
  }

  walk(parts) {
    let node = this.root;
    for (const p of parts) {
      if (typeof node === "string") throw new Error("not a directory");
      if (!node.has(p)) throw new Error("not found");
      node = node.get(p);
    }
    return node;
  }

  parent(parts) {
    if (parts.length === 0) throw new Error("is a directory");
    const parent = this.walk(parts.slice(0, -1));
    if (typeof parent === "string") throw new Error("not a directory");
    return [parent, parts[parts.length - 1]];
  }

  mkdir(path) {
    let node = this.root;
    for (const p of this.parts(path)) {
      if (!node.has(p)) node.set(p, new Map());
      else if (typeof node.get(p) === "string")
        throw new Error("already exists");
      node = node.get(p);
    }
  }

  write(path, text) {
    const [parent, name] = this.parent(this.parts(path));
    if (parent.get(name) instanceof Map) throw new Error("is a directory");
    parent.set(name, text);
  }

  appendTo(path, text) {
    const [parent, name] = this.parent(this.parts(path));
    const old = parent.get(name);
    if (old instanceof Map) throw new Error("is a directory");
    parent.set(name, (old ?? "") + text);
  }

  read(path) {
    const node = this.walk(this.parts(path));
    if (node instanceof Map) throw new Error("is a directory");
    return node;
  }

  ls(path) {
    const parts = this.parts(path);
    const node = this.walk(parts);
    return node instanceof Map
      ? [...node.keys()].sort()
      : [parts[parts.length - 1]];
  }

  rm(path) {
    const [parent, name] = this.parent(this.parts(path));
    const node = parent.get(name);
    if (node === undefined) throw new Error("not found");
    if (node instanceof Map && node.size > 0)
      throw new Error("directory not empty");
    parent.delete(name);
  }

  // The extension round.
  mv(source, target) {
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

  size(path) {
    const total = (node) =>
      node instanceof Map
        ? [...node.values()].reduce((sum, n) => sum + total(n), 0)
        : node.length;
    return total(this.walk(this.parts(path)));
  }
}

module.exports = { FileSystem };
