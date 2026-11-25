// The flyweight: one immutable record per distinct text, shared by every occurrence.
interface SymbolEntry {
  readonly id: number;
  readonly text: string;
}

// The flyweight factory: hands out the one shared symbol for a text, making it only the
// first time the text is seen.
export class Interner {
  private readonly byText = new Map<string, SymbolEntry>();
  private readonly byId: SymbolEntry[] = [];
  private saved = 0;

  intern(text: string): number {
    if (text === "") throw new RangeError("empty text");
    const shared = this.byText.get(text);
    if (shared !== undefined) {
      this.saved += text.length;
      return shared.id;
    }
    const symbol: SymbolEntry = Object.freeze({ id: this.byId.length, text });
    this.byText.set(text, symbol);
    this.byId.push(symbol);
    return symbol.id;
  }

  lookup(id: number): string {
    const symbol = this.byId[id];
    if (symbol === undefined) throw new RangeError("unknown id");
    return symbol.text;
  }

  size(): number {
    return this.byId.length;
  }

  bytesSaved(): number {
    return this.saved;
  }
}
