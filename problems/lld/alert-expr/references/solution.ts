const KEYWORDS = ["and", "or", "not"];
const MAX_DIGITS = 15;
const OPS = new Map<string, (a: number, b: number) => boolean>([
  [">", (a, b) => a > b],
  [">=", (a, b) => a >= b],
  ["<", (a, b) => a < b],
  ["<=", (a, b) => a <= b],
  ["==", (a, b) => a === b],
  ["!=", (a, b) => a !== b],
]);
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isDigit = (c: string) => c >= "0" && c <= "9";
const isLetter = (c: string) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isNameChar = (c: string) =>
  isLetter(c) || isDigit(c) || c === "_" || c === ".";
const isName = (s: string) =>
  s.length > 0 &&
  isLetter(s.charAt(0)) &&
  [...s].every(isNameChar) &&
  !KEYWORDS.includes(s);

class Tally {
  comparisons = 0;
}

// An expression in the language: a comparison, or not, and, or over expressions.
interface Node {
  evaluate(metrics: Record<string, number>, seen: Tally): boolean;
  depth(): number;
  names(out: Set<string>): void;
  rename(from: string, to: string): void;
  text(): string;
}

class Compare implements Node {
  private metric: string;
  private readonly op: string;
  private readonly value: number;

  constructor(metric: string, op: string, value: number) {
    this.metric = metric;
    this.op = op;
    this.value = value;
  }

  evaluate(metrics: Record<string, number>, seen: Tally): boolean {
    seen.comparisons += 1;
    // Only the snapshot's own keys: "constructor" is a metric name, not a property.
    const current = Object.hasOwn(metrics, this.metric)
      ? metrics[this.metric]
      : undefined;
    const test = OPS.get(this.op);
    return (
      current !== undefined && test !== undefined && test(current, this.value)
    );
  }

  depth(): number {
    return 1;
  }

  names(out: Set<string>): void {
    out.add(this.metric);
  }

  rename(from: string, to: string): void {
    if (this.metric === from) this.metric = to;
  }

  text(): string {
    return `${this.metric} ${this.op} ${String(this.value)}`;
  }
}

class Not implements Node {
  private readonly inner: Node;

  constructor(inner: Node) {
    this.inner = inner;
  }

  evaluate(metrics: Record<string, number>, seen: Tally): boolean {
    return !this.inner.evaluate(metrics, seen);
  }

  depth(): number {
    return 1 + this.inner.depth();
  }

  names(out: Set<string>): void {
    this.inner.names(out);
  }

  rename(from: string, to: string): void {
    this.inner.rename(from, to);
  }

  text(): string {
    return `not ${this.inner.text()}`;
  }
}

class Binary implements Node {
  private readonly word: "and" | "or";
  private readonly left: Node;
  private readonly right: Node;

  constructor(word: "and" | "or", left: Node, right: Node) {
    this.word = word;
    this.left = left;
    this.right = right;
  }

  evaluate(metrics: Record<string, number>, seen: Tally): boolean {
    return this.word === "and"
      ? this.left.evaluate(metrics, seen) && this.right.evaluate(metrics, seen)
      : this.left.evaluate(metrics, seen) || this.right.evaluate(metrics, seen);
  }

  depth(): number {
    return 1 + Math.max(this.left.depth(), this.right.depth());
  }

  names(out: Set<string>): void {
    this.left.names(out);
    this.right.names(out);
  }

  rename(from: string, to: string): void {
    this.left.rename(from, to);
    this.right.rename(from, to);
  }

  text(): string {
    return `(${this.left.text()} ${this.word} ${this.right.text()})`;
  }
}

interface Token {
  kind: "number" | "word" | "symbol";
  text: string;
}

function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  for (; i < s.length;) {
    const c = s.charAt(i);
    const two = s.slice(i, i + 2);
    let j = i + 1;
    if (c === " ") {
      i = j;
      continue;
    }
    if (isDigit(c) || (c === "-" && isDigit(s.charAt(j)))) {
      for (; j < s.length && isDigit(s.charAt(j)); j++);
      tokens.push({ kind: "number", text: s.slice(i, j) });
    } else if (isLetter(c)) {
      for (; j < s.length && isNameChar(s.charAt(j)); j++);
      tokens.push({ kind: "word", text: s.slice(i, j) });
    } else if (OPS.has(two)) {
      j = i + 2;
      tokens.push({ kind: "symbol", text: two });
    } else if ("<>()".includes(c)) {
      tokens.push({ kind: "symbol", text: c });
    } else throw new Error("unexpected character");
    i = j;
  }
  return tokens;
}

// Recursive descent: each method parses one level of the grammar.
class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(text: string) {
    this.tokens = tokenize(text);
  }

  parse(): Node {
    const tree = this.disjunction();
    if (this.pos !== this.tokens.length) throw new Error("unexpected token");
    return tree;
  }

  private disjunction(): Node {
    let tree = this.conjunction();
    while (this.take("or")) tree = new Binary("or", tree, this.conjunction());
    return tree;
  }

  private conjunction(): Node {
    let tree = this.negation();
    while (this.take("and")) tree = new Binary("and", tree, this.negation());
    return tree;
  }

  private negation(): Node {
    if (this.take("not")) return new Not(this.negation());
    if (this.take("(")) {
      const tree = this.disjunction();
      this.expect("symbol", ")");
      return tree;
    }
    const metric = this.expect("word");
    if (KEYWORDS.includes(metric)) throw new Error("a keyword is not a metric");
    const op = this.expect("symbol");
    if (!OPS.has(op)) throw new Error("not a comparison");
    const number = this.expect("number");
    if (number.replace("-", "").length > MAX_DIGITS)
      throw new Error("number too long");
    return new Compare(metric, op, Number(number));
  }

  private take(text: string): boolean {
    const found = this.tokens[this.pos]?.text === text;
    if (found) this.pos += 1;
    return found;
  }

  private expect(kind: Token["kind"], text?: string): string {
    const got = this.tokens[this.pos];
    if (
      got === undefined ||
      got.kind !== kind ||
      (text !== undefined && got.text !== text)
    )
      throw new Error("unexpected token");
    this.pos += 1;
    return got.text;
  }
}

export class AlertExpr {
  private readonly tree: Node;
  private readonly seen = new Tally();

  constructor(expression: string) {
    this.tree = new Parser(expression).parse();
  }

  evaluate(metrics: Record<string, number>): boolean {
    return this.tree.evaluate(metrics, this.seen);
  }

  variables(): string[] {
    const out = new Set<string>();
    this.tree.names(out);
    return [...out].sort(byCode);
  }

  depth(): number {
    return this.tree.depth();
  }

  evaluations(): number {
    return this.seen.comparisons;
  }

  // The extension round: renaming a metric in the parsed tree.
  rewrite(name: string, replacement: string): string {
    if (!this.variables().includes(name) || !isName(replacement))
      throw new Error("unknown metric or bad name");
    this.tree.rename(name, replacement);
    return this.tree.text();
  }
}
