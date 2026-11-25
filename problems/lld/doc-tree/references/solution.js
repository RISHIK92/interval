"use strict";

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// A path is a list of segments: a key (string) steps into an object, an index (number)
// into an array.
function key(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new RangeError("not a key");
  return text;
}

function index(text) {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new RangeError("not an index");
  return Number(text);
}

function parse(path) {
  if (path === "") return [];
  const segments = [];
  for (const part of path.split(".")) {
    const [name, ...indexes] = part.split("[");
    segments.push(key(name));
    for (const piece of indexes) {
      if (!piece.endsWith("]")) throw new RangeError("an unclosed [");
      segments.push(index(piece.slice(0, -1)));
    }
  }
  return segments;
}

function join(at, segment) {
  if (typeof segment === "number") return `${at}[${segment}]`;
  return at === "" ? segment : `${at}.${segment}`;
}

// The composite: scalars, objects and arrays answer the same questions (child, summary,
// size, leaves), and a branch answers by asking its children. Branches can also grow.
class Scalar {
  constructor(value) {
    this.value = value;
  }

  child() {
    return undefined;
  }

  summary() {
    return this.value;
  }

  size() {
    return 0;
  }

  leaves(at) {
    return [at];
  }
}

class ObjectNode {
  #children = new Map();

  child(segment) {
    return typeof segment === "string"
      ? this.#children.get(segment)
      : undefined;
  }

  room(segment) {
    return typeof segment === "string";
  }

  attach(segment, node) {
    this.#children.set(segment, node);
  }

  detach(segment) {
    this.#children.delete(segment);
  }

  summary() {
    return `object(${this.#children.size})`;
  }

  size() {
    let total = 0;
    for (const child of this.#children.values()) total += 1 + child.size();
    return total;
  }

  leaves(at) {
    const out = [];
    for (const name of [...this.#children.keys()].sort(byCode))
      out.push(...this.#children.get(name).leaves(join(at, name)));
    return out;
  }
}

class ArrayNode {
  #items = [];

  child(segment) {
    return typeof segment === "number" ? this.#items[segment] : undefined;
  }

  // An array only grows at its end.
  room(segment) {
    return segment === this.#items.length;
  }

  attach(_segment, node) {
    this.#items.push(node);
  }

  detach(segment) {
    this.#items.splice(segment, 1);
  }

  summary() {
    return `array(${this.#items.length})`;
  }

  size() {
    return this.#items.reduce((total, item) => total + 1 + item.size(), 0);
  }

  leaves(at) {
    return this.#items.flatMap((item, i) => item.leaves(join(at, i)));
  }
}

class DocTree {
  #root = new ObjectNode();

  put(path, val) {
    const segments = parse(path);
    if (segments.length === 0 || val === "")
      throw new RangeError(
        "the root can't be a scalar, and a value isn't empty",
      );
    const [node, rest] = this.#walk(segments);
    if (rest.length > 0) return this.#grow(node, rest, new Scalar(val));
    if (!(node instanceof Scalar)) return false;
    node.value = val;
    return true;
  }

  read(path) {
    return this.#find(parse(path))?.summary() ?? null;
  }

  remove(path) {
    const segments = parse(path);
    if (segments.length === 0) throw new RangeError("the root stays");
    const last = segments[segments.length - 1];
    const parent = this.#find(segments.slice(0, -1));
    if (
      parent === undefined ||
      parent instanceof Scalar ||
      parent.child(last) === undefined
    )
      return false;
    parent.detach(last);
    return true;
  }

  paths(prefix) {
    return this.#find(parse(prefix))?.leaves(prefix) ?? [];
  }

  count(path) {
    const node = this.#find(parse(path));
    if (node === undefined) throw new RangeError("no such node");
    return node.size();
  }

  // The extension round: a shallow merge of scalars into one object.
  merge(path, entries) {
    const segments = parse(path);
    for (const [name, value] of Object.entries(entries)) {
      key(name);
      if (value === "") throw new RangeError("an empty value");
    }
    let [node, rest] = this.#walk(segments);
    if (rest.length > 0) {
      const made = new ObjectNode();
      if (!this.#grow(node, rest, made))
        throw new RangeError("the path can't be made");
      node = made;
    }
    if (!(node instanceof ObjectNode))
      throw new RangeError("only an object can be merged into");
    let changed = 0;
    for (const [name, value] of Object.entries(entries)) {
      const old = node.child(name);
      if (old instanceof Scalar && old.value === value) continue;
      node.attach(name, new Scalar(value));
      changed += 1;
    }
    return changed;
  }

  // Follows the path as far as it exists: the last node reached and the segments to go.
  #walk(segments) {
    let node = this.#root;
    for (let i = 0; i < segments.length; i++) {
      const child = node.child(segments[i]);
      if (child === undefined) return [node, segments.slice(i)];
      node = child;
    }
    return [node, []];
  }

  #find(segments) {
    const [node, rest] = this.#walk(segments);
    return rest.length > 0 ? undefined : node;
  }

  // Creates the missing part of a path, each new branch an object or an array as the
  // segment after it needs, or refuses without changing anything.
  #grow(parent, rest, leaf) {
    if (parent instanceof Scalar || !parent.room(rest[0])) return false;
    // Every array made here is new and empty, so it can only take index 0.
    if (rest.slice(1).some((s) => typeof s === "number" && s !== 0))
      return false;
    let branch = parent;
    for (let i = 0; i + 1 < rest.length; i++) {
      const made =
        typeof rest[i + 1] === "string" ? new ObjectNode() : new ArrayNode();
      branch.attach(rest[i], made);
      branch = made;
    }
    branch.attach(rest[rest.length - 1], leaf);
    return true;
  }
}

module.exports = { DocTree };
