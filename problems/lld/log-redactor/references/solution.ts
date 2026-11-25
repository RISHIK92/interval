// One kind of secret: a rule rewrites the words it matches and counts them. The
// redactor only decides which rules run and in what order.
interface Rule {
  apply(words: string[]): number;
}

const emails: Rule = {
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

const cards: Rule = {
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
function afterWord(prefix: string, mask: string): Rule {
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

export class Redactor {
  private readonly rules = new Map<string, Rule>();
  private readonly enabled: string[] = [];
  private readonly counts = new Map<string, number>();

  constructor() {
    this.add("email", emails);
    this.add("card", cards);
    this.add("bearer", afterWord("Bearer", "[token]"));
  }

  private add(name: string, rule: Rule): void {
    this.rules.set(name, rule);
    this.counts.set(name, 0);
  }

  private known(rule: string): string {
    if (!this.rules.has(rule)) throw new RangeError("unknown rule");
    return rule;
  }

  enable(rule: string): void {
    if (!this.enabled.includes(this.known(rule))) this.enabled.push(rule);
  }

  disable(rule: string): void {
    const at = this.enabled.indexOf(this.known(rule));
    if (at >= 0) this.enabled.splice(at, 1);
  }

  redact(line: string): string {
    const words = line.split(" ");
    for (const name of this.enabled) {
      const hits = this.rules.get(name)?.apply(words) ?? 0;
      this.counts.set(name, (this.counts.get(name) ?? 0) + hits);
    }
    return words.join(" ");
  }

  hits(rule: string): number {
    return this.counts.get(this.known(rule)) ?? 0;
  }

  // The extension round: a new rule is one more entry, run like any other.
  maskAfter(name: string, prefix: string): void {
    if (name === "" || this.rules.has(name))
      throw new RangeError("a rule needs a new, non-empty name");
    if (prefix === "" || prefix.includes(" "))
      throw new RangeError("the prefix is one word");
    this.add(name, afterWord(prefix, `[${name}]`));
  }
}
