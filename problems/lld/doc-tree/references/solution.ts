const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// A path is a list of segments: a key (string) steps into an object, an index (number)
// into an array.
type Segment = string | number;

function key(text: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new RangeError("not a key");
  return text;
}

function index(text: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new RangeError("not an index");
  return Number(text);
}

function parse(path: string): Segment[] {
  if (path === "") return [];
  const segments: Segment[] = [];
  for (const part of path.split(".")) {
    const [name = "", ...indexes] = part.split("[");
    segments.push(key(name));
    for (const piece of indexes) {
      if (!piece.endsWith("]")) throw new RangeError("an unclosed [");
      segments.push(index(piece.slice(0, -1)));
    }
  }
  return segments;
}

function join(at: string, segment: Segment): string {
  if (typeof segment === "number") return `${at}[${String(segment)}]`;
  return at === "" ? segment : `${at}.${segment}`;
}

// The composite: scalars, objects and arrays answer the same questions, and a branch
// answers by asking its children.
interface DocNode {
  child(segment: Segment): DocNode | undefined;
  summary(): string;
  size(): number;
  leaves(at: string): string[];
}

interface Branch extends DocNode {
  room(segment: Segment): boolean;
  attach(segment: Segment, node: DocNode): void;
  detach(segment: Segment): void;
}

function isBranch(node: DocNode): node is Branch {
  return "attach" in node;
}

class Scalar implements DocNode {
  value: string;

  constructor(value: string) {
    this.value = value;
  }

  child(): DocNode | undefined {
    return undefined;
  }

  summary(): string {
    return this.value;
  }

  size(): number {
    return 0;
  }

  leaves(at: string): string[] {
    return [at];
  }
}

class ObjectNode implements Branch {
  private readonly children = new Map<string, DocNode>();

  child(segment: Segment): DocNode | undefined {
    return typeof segment === "string" ? this.children.get(segment) : undefined;
  }

  room(segment: Segment): boolean {
    return typeof segment === "string";
  }

  attach(segment: Segment, node: DocNode): void {
    this.children.set(String(segment), node);
  }

  detach(segment: Segment): void {
    this.children.delete(String(segment));
  }

  summary(): string {
    return `object(${String(this.children.size)})`;
  }

  size(): number {
    let total = 0;
    for (const child of this.children.values()) total += 1 + child.size();
    return total;
  }

  leaves(at: string): string[] {
    const out: string[] = [];
    for (const name of [...this.children.keys()].sort(byCode))
      out.push(...(this.children.get(name)?.leaves(join(at, name)) ?? []));
    return out;
  }
}

class ArrayNode implements Branch {
  private readonly items: DocNode[] = [];

  child(segment: Segment): DocNode | undefined {
    return typeof segment === "number" ? this.items[segment] : undefined;
  }

  // An array only grows at its end.
  room(segment: Segment): boolean {
    return segment === this.items.length;
  }

  attach(_segment: Segment, node: DocNode): void {
    this.items.push(node);
  }

  detach(segment: Segment): void {
    this.items.splice(Number(segment), 1);
  }

  summary(): string {
    return `array(${String(this.items.length)})`;
  }

  size(): number {
    return this.items.reduce((total, item) => total + 1 + item.size(), 0);
  }

  leaves(at: string): string[] {
    return this.items.flatMap((item, i) => item.leaves(join(at, i)));
  }
}

export class DocTree {
  private readonly root = new ObjectNode();

  put(path: string, val: string): boolean {
    const segments = parse(path);
    if (segments.length === 0 || val === "")
      throw new RangeError(
        "the root can't be a scalar, and a value isn't empty",
      );
    const [node, rest] = this.walk(segments);
    if (rest.length > 0) return this.grow(node, rest, new Scalar(val));
    if (!(node instanceof Scalar)) return false;
    node.value = val;
    return true;
  }

  read(path: string): string | null {
    return this.find(parse(path))?.summary() ?? null;
  }

  remove(path: string): boolean {
    const segments = parse(path);
    const last = segments.at(-1);
    if (last === undefined) throw new RangeError("the root stays");
    const parent = this.find(segments.slice(0, -1));
    if (
      parent === undefined ||
      !isBranch(parent) ||
      parent.child(last) === undefined
    )
      return false;
    parent.detach(last);
    return true;
  }

  paths(prefix: string): string[] {
    return this.find(parse(prefix))?.leaves(prefix) ?? [];
  }

  count(path: string): number {
    const node = this.find(parse(path));
    if (node === undefined) throw new RangeError("no such node");
    return node.size();
  }

  // The extension round: a shallow merge of scalars into one object.
  merge(path: string, entries: Record<string, string>): number {
    const segments = parse(path);
    for (const [name, value] of Object.entries(entries)) {
      key(name);
      if (value === "") throw new RangeError("an empty value");
    }
    const [found, rest] = this.walk(segments);
    let node = found;
    if (rest.length > 0) {
      const made = new ObjectNode();
      if (!this.grow(found, rest, made))
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
  private walk(segments: Segment[]): [DocNode, Segment[]] {
    let node: DocNode = this.root;
    for (let i = 0; i < segments.length; i++) {
      const child = node.child(segments[i] ?? "");
      if (child === undefined) return [node, segments.slice(i)];
      node = child;
    }
    return [node, []];
  }

  private find(segments: Segment[]): DocNode | undefined {
    const [node, rest] = this.walk(segments);
    return rest.length > 0 ? undefined : node;
  }

  // Creates the missing part of a path, each new branch an object or an array as the
  // segment after it needs, or refuses without changing anything.
  private grow(parent: DocNode, rest: Segment[], leaf: DocNode): boolean {
    if (!isBranch(parent) || !parent.room(rest[0] ?? "")) return false;
    // Every array made here is new and empty, so it can only take index 0.
    if (rest.slice(1).some((s) => typeof s === "number" && s !== 0))
      return false;
    let branch: Branch = parent;
    for (let i = 0; i + 1 < rest.length; i++) {
      const made: Branch =
        typeof rest[i + 1] === "string" ? new ObjectNode() : new ArrayNode();
      branch.attach(rest[i] ?? "", made);
      branch = made;
    }
    branch.attach(rest[rest.length - 1] ?? "", leaf);
    return true;
  }
}
