"use strict";

const KEYWORDS = ["and", "or", "not"];
const MAX_DIGITS = 15;
const OPS = new Map([
  [">", (a, b) => a > b],
  [">=", (a, b) => a >= b],
  ["<", (a, b) => a < b],
  ["<=", (a, b) => a <= b],
  ["==", (a, b) => a === b],
  ["!=", (a, b) => a !== b],
]);
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isDigit = (c) => c >= "0" && c <= "9";
const isLetter = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
const isNameChar = (c) => isLetter(c) || isDigit(c) || c === "_" || c === ".";
const isName = (s) =>
  s.length > 0 &&
  isLetter(s.charAt(0)) &&
  [...s].every(isNameChar) &&
  !KEYWORDS.includes(s);

// The tree's nodes: a comparison, or not, and, or over expressions. Each one gives
// evaluate(metrics, tally), depth(), names(out), rename(from, to) and text().
class Compare {
  constructor(metric, op, value) {
    this.metric = metric;
    this.op = op;
    this.value = value;
  }

  evaluate(metrics, tally) {
    tally.comparisons += 1;
    // Only the snapshot's own keys: "constructor" is a metric name, not a property.
    return (
      Object.hasOwn(metrics, this.metric) &&
      OPS.get(this.op)(metrics[this.metric], this.value)
    );
  }

  depth() {
    return 1;
  }

  names(out) {
    out.add(this.metric);
  }

  rename(from, to) {
    if (this.metric === from) this.metric = to;
  }

  text() {
    return `${this.metric} ${this.op} ${this.value}`;
  }
}

class Not {
  constructor(inner) {
    this.inner = inner;
  }

  evaluate(metrics, tally) {
    return !this.inner.evaluate(metrics, tally);
  }

  depth() {
    return 1 + this.inner.depth();
  }

  names(out) {
    this.inner.names(out);
  }

  rename(from, to) {
    this.inner.rename(from, to);
  }

  text() {
    return `not ${this.inner.text()}`;
  }
}

class Binary {
  constructor(word, left, right) {
    this.word = word;
    this.left = left;
    this.right = right;
  }

  evaluate(metrics, tally) {
    return this.word === "and"
      ? this.left.evaluate(metrics, tally) &&
          this.right.evaluate(metrics, tally)
      : this.left.evaluate(metrics, tally) ||
          this.right.evaluate(metrics, tally);
  }

  depth() {
    return 1 + Math.max(this.left.depth(), this.right.depth());
  }

  names(out) {
    this.left.names(out);
    this.right.names(out);
  }

  rename(from, to) {
    this.left.rename(from, to);
    this.right.rename(from, to);
  }

  text() {
    return `(${this.left.text()} ${this.word} ${this.right.text()})`;
  }
}

function tokenize(s) {
  const tokens = [];
  for (let i = 0; i < s.length;) {
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
  constructor(text) {
    this.tokens = tokenize(text);
    this.pos = 0;
  }

  parse() {
    const tree = this.disjunction();
    if (this.pos !== this.tokens.length) throw new Error("unexpected token");
    return tree;
  }

  disjunction() {
    let tree = this.conjunction();
    while (this.take("or")) tree = new Binary("or", tree, this.conjunction());
    return tree;
  }

  conjunction() {
    let tree = this.negation();
    while (this.take("and")) tree = new Binary("and", tree, this.negation());
    return tree;
  }

  negation() {
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

  take(text) {
    const found = this.tokens[this.pos]?.text === text;
    if (found) this.pos += 1;
    return found;
  }

  expect(kind, text) {
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

class AlertExpr {
  constructor(expression) {
    this.tree = new Parser(expression).parse();
    this.tally = { comparisons: 0 };
  }

  evaluate(metrics) {
    return this.tree.evaluate(metrics, this.tally);
  }

  variables() {
    const out = new Set();
    this.tree.names(out);
    return [...out].sort(byCode);
  }

  depth() {
    return this.tree.depth();
  }

  evaluations() {
    return this.tally.comparisons;
  }

  // The extension round: renaming a metric in the parsed tree.
  rewrite(name, replacement) {
    if (!this.variables().includes(name) || !isName(replacement))
      throw new Error("unknown metric or bad name");
    this.tree.rename(name, replacement);
    return this.tree.text();
  }
}

module.exports = { AlertExpr };
