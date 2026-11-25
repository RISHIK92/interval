// One check over one line. The linter only knows this, so a new rule is a new class and an
// entry in RULES, and no existing rule or the linter itself is edited.
interface Rule {
  flags(line: string): boolean;
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function unused(param: number): void {
  if (param !== 0) throw new RangeError("this rule takes no parameter");
}

class MaxLineLength implements Rule {
  private readonly limit: number;

  constructor(param: number) {
    if (param < 1) throw new RangeError("a maximum is at least 1");
    this.limit = param;
  }

  flags(line: string): boolean {
    return line.length > this.limit;
  }
}

class NoTabs implements Rule {
  constructor(param: number) {
    unused(param);
  }

  flags(line: string): boolean {
    return line.includes("\t");
  }
}

class NoTrailingSpaces implements Rule {
  constructor(param: number) {
    unused(param);
  }

  flags(line: string): boolean {
    return line.endsWith(" ");
  }
}

const RULES = new Map<string, (param: number) => Rule>([
  ["max-line-length", (p) => new MaxLineLength(p)],
  ["no-tabs", (p) => new NoTabs(p)],
  ["no-trailing-spaces", (p) => new NoTrailingSpaces(p)],
]);

// The extension round's rule: written and added without touching the ones above.
class BannedWords implements Rule {
  readonly words = new Set<string>();

  flags(line: string): boolean {
    return [...this.words].some((word) => line.includes(word));
  }
}

export class Linter {
  private readonly rules = new Map<string, Rule>();
  private banned: BannedWords | null = null;

  enable(rule: string, param: number): void {
    const made = RULES.get(rule);
    if (made === undefined) throw new RangeError("unknown rule");
    this.rules.set(rule, made(param));
  }

  lint(lines: string[]): string[] {
    const named = this.namedRules();
    return lines.flatMap((line, i) =>
      named
        .filter(([, rule]) => rule.flags(line))
        .map(([name]) => `${String(i + 1)}:${name}`),
    );
  }

  enabled(): string[] {
    return this.namedRules().map(([name]) => name);
  }

  // The extension round: one more rule, added beside the others.
  banWord(word: string): void {
    if (word === "") throw new RangeError("empty word");
    if (this.banned === null) {
      this.banned = new BannedWords();
      this.rules.set("ban-word", this.banned);
    }
    this.banned.words.add(word);
  }

  private namedRules(): [string, Rule][] {
    return [...this.rules].sort(([a], [b]) => byCode(a, b));
  }
}
