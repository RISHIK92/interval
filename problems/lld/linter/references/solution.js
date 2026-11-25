"use strict";

// Every rule has one method, flags(line). The linter only calls that, so a new rule is a
// new class and an entry in RULES, and no existing rule or the linter itself is edited.

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function unused(param) {
  if (param !== 0) throw new RangeError("this rule takes no parameter");
}

class MaxLineLength {
  #limit;

  constructor(param) {
    if (param < 1) throw new RangeError("a maximum is at least 1");
    this.#limit = param;
  }

  flags(line) {
    return line.length > this.#limit;
  }
}

class NoTabs {
  constructor(param) {
    unused(param);
  }

  flags(line) {
    return line.includes("\t");
  }
}

class NoTrailingSpaces {
  constructor(param) {
    unused(param);
  }

  flags(line) {
    return line.endsWith(" ");
  }
}

const RULES = new Map([
  ["max-line-length", (p) => new MaxLineLength(p)],
  ["no-tabs", (p) => new NoTabs(p)],
  ["no-trailing-spaces", (p) => new NoTrailingSpaces(p)],
]);

// The extension round's rule: written and added without touching the ones above.
class BannedWords {
  words = new Set();

  flags(line) {
    return [...this.words].some((word) => line.includes(word));
  }
}

class Linter {
  #rules = new Map();
  #banned = null;

  enable(rule, param) {
    const made = RULES.get(rule);
    if (made === undefined) throw new RangeError("unknown rule");
    this.#rules.set(rule, made(param));
  }

  lint(lines) {
    const named = this.#namedRules();
    return lines.flatMap((line, i) =>
      named
        .filter(([, rule]) => rule.flags(line))
        .map(([name]) => `${i + 1}:${name}`),
    );
  }

  enabled() {
    return this.#namedRules().map(([name]) => name);
  }

  // The extension round: one more rule, added beside the others.
  banWord(word) {
    if (word === "") throw new RangeError("empty word");
    if (this.#banned === null) {
      this.#banned = new BannedWords();
      this.#rules.set("ban-word", this.#banned);
    }
    this.#banned.words.add(word);
  }

  #namedRules() {
    return [...this.#rules].sort(([a], [b]) => byCode(a, b));
  }
}

module.exports = { Linter };
