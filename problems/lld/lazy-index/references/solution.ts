const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function termsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

// What callers see: the real index and its proxy answer the same calls.
interface SearchIndex {
  addDoc(id: string, text: string): void;
  search(term: string): string[];
  removeDoc(id: string): boolean;
}

// The real subject: each term maps to the documents that contain it. Building it reads
// every document, which is the work the proxy puts off.
class InvertedIndex implements SearchIndex {
  private readonly postings = new Map<string, Set<string>>();
  private readonly docs = new Map<string, Set<string>>();

  constructor(docs: ReadonlyMap<string, string>) {
    for (const [id, text] of docs) this.addDoc(id, text);
  }

  addDoc(id: string, text: string): void {
    this.removeDoc(id);
    const terms = termsOf(text);
    this.docs.set(id, terms);
    for (const term of terms) {
      const ids = this.postings.get(term) ?? new Set<string>();
      ids.add(id);
      this.postings.set(term, ids);
    }
  }

  search(term: string): string[] {
    return [...(this.postings.get(term.toLowerCase()) ?? [])].sort(byCode);
  }

  removeDoc(id: string): boolean {
    const terms = this.docs.get(id);
    if (terms === undefined) return false;
    this.docs.delete(id);
    for (const term of terms) this.postings.get(term)?.delete(id);
    return true;
  }

  size(): number {
    return this.docs.size;
  }
}

// A virtual proxy: it answers like the index, but holds only the raw documents until the
// first search needs the real one. After that, every change goes straight to the real
// index, one document at a time, so it's never built twice.
export class LazyIndex implements SearchIndex {
  private readonly pending = new Map<string, string>();
  private index: InvertedIndex | null = null;
  private buildCount = 0;

  private real(): InvertedIndex {
    if (this.index === null) {
      this.index = new InvertedIndex(this.pending);
      this.buildCount += 1;
    }
    return this.index;
  }

  addDoc(id: string, text: string): void {
    if (id === "" || text === "") throw new RangeError("empty");
    if (this.index === null) this.pending.set(id, text);
    else this.index.addDoc(id, text);
  }

  search(term: string): string[] {
    if (!/^[A-Za-z0-9]+$/.test(term))
      throw new RangeError("a term is letters and digits");
    return this.real().search(term);
  }

  builds(): number {
    return this.buildCount;
  }

  indexed(): number {
    return this.index === null ? 0 : this.index.size();
  }

  // The extension round: documents leave without a rebuild either.
  removeDoc(id: string): boolean {
    if (id === "") throw new RangeError("empty");
    if (this.index === null) return this.pending.delete(id);
    return this.index.removeDoc(id);
  }
}
