"use strict";

// Each rule is one kind of secret: it rewrites the words it matches and counts them.
// The redactor only decides which rules run and in what order.
const emails = {
  apply(words) {
    let hits = 0;
    words.forEach((word, i) => {
      const at = word.indexOf("@");
      const domain = word.slice(at + 1);
      if (
        at > 0 &&
        !domain.includes("@") &&
        domain.slice(1, -1).includes(".")
      ) {
        words[i] = "[email]";
        hits += 1;
      }
    });
    return hits;
  },
};

const cards = {
  apply(words) {
    let hits = 0;
    words.forEach((word, i) => {
      if (/^[0-9]{13,19}$/.test(word)) {
        words[i] = "*".repeat(word.length - 4) + word.slice(-4);
        hits += 1;
      }
    });
    return hits;
  },
};

// Masks the word that comes right after a given word, left to right.
function afterWord(prefix, mask) {
  return {
    apply(words) {
      let hits = 0;
      for (let i = 0; i + 1 < words.length; i++) {
        if (words[i] === prefix && words[i + 1] !== "") {
          words[i + 1] = mask;
          hits += 1;
        }
      }
      return hits;
    },
  };
}

class Redactor {
  #rules = new Map([
    ["email", emails],
    ["card", cards],
    ["bearer", afterWord("Bearer", "[token]")],
  ]);
  #enabled = [];
  #hits = new Map([...this.#rules.keys()].map((name) => [name, 0]));

  #known(rule) {
    if (!this.#rules.has(rule)) throw new RangeError("unknown rule");
    return rule;
  }

  enable(rule) {
    if (!this.#enabled.includes(this.#known(rule))) this.#enabled.push(rule);
  }

  disable(rule) {
    const at = this.#enabled.indexOf(this.#known(rule));
    if (at >= 0) this.#enabled.splice(at, 1);
  }

  redact(line) {
    const words = line.split(" ");
    for (const name of this.#enabled)
      this.#hits.set(
        name,
        this.#hits.get(name) + this.#rules.get(name).apply(words),
      );
    return words.join(" ");
  }

  hits(rule) {
    return this.#hits.get(this.#known(rule));
  }

  // The extension round: a new rule is one more entry, run like any other.
  maskAfter(name, prefix) {
    if (name === "" || this.#rules.has(name))
      throw new RangeError("a rule needs a new, non-empty name");
    if (prefix === "" || prefix.includes(" "))
      throw new RangeError("the prefix is one word");
    this.#rules.set(name, afterWord(prefix, `[${name}]`));
    this.#hits.set(name, 0);
  }
}

module.exports = { Redactor };
