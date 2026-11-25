// Lowest precedence first: a later source overrides an earlier one.
const SOURCES = ["defaults", "file", "env", "flags"];
const INTEGER = /^-?[0-9]{1,15}$/;

// Parsing is its own concern: lookup finds the text, this decides what it means.
function parseInteger(text: string): number {
  if (!INTEGER.test(text)) throw new RangeError("not an integer");
  return Number(text) + 0; // + 0 turns -0 into 0
}

// Each source's entries are kept as given; only resolution knows the precedence.
export class LayeredConfig {
  private readonly layers = new Map<string, Map<string, string>>(
    SOURCES.map((s) => [s, new Map()]),
  );
  private readonly renamed = new Map<string, string>(); // old key -> new key

  layer(source: string, entries: Record<string, string>): void {
    if (!this.layers.has(source)) throw new RangeError("unknown source");
    const copy = new Map(Object.entries(entries));
    if (copy.has("")) throw new RangeError("a key is not empty");
    this.layers.set(source, copy);
  }

  // The names a setting may be written under, the current one first.
  private names(key: string): string[] {
    if (key === "") throw new RangeError("a key is not empty");
    const current = this.renamed.get(key) ?? key;
    const old = [...this.renamed]
      .filter(([, n]) => n === current)
      .map(([o]) => o);
    return [current, ...old];
  }

  private winner(key: string): [string, string] | null {
    const names = this.names(key);
    for (const source of [...SOURCES].reverse()) {
      const entries = this.layers.get(source);
      for (const name of names) {
        const value = entries?.get(name);
        if (value !== undefined) return [source, value];
      }
    }
    return null;
  }

  lookup(key: string): string | null {
    return this.winner(key)?.[1] ?? null;
  }

  origin(key: string): string | null {
    return this.winner(key)?.[0] ?? null;
  }

  intValue(key: string): number | null {
    const found = this.winner(key);
    return found === null ? null : parseInteger(found[1]);
  }

  // The extension round: a renamed setting answers to both names.
  alias(oldKey: string, newKey: string): void {
    if (oldKey === "" || newKey === "" || oldKey === newKey)
      throw new RangeError("two different, non-empty keys");
    const used = new Set([...this.renamed.keys(), ...this.renamed.values()]);
    if (used.has(oldKey) || used.has(newKey))
      throw new RangeError("a key is in at most one alias");
    this.renamed.set(oldKey, newKey);
  }
}
