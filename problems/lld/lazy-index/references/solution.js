"use strict";

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function termsOf(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

// The real subject: each term maps to the documents that contain it. Building it reads
// every document, which is the work the proxy puts off. It answers the same addDoc,
// search and removeDoc as the proxy.
class InvertedIndex {
  constructor(docs) {
    this.postings = new Map();
    this.docs = new Map();
    for (const [id, text] of docs) this.addDoc(id, text);
  }

  addDoc(id, text) {
    this.removeDoc(id);
    const terms = termsOf(text);
    this.docs.set(id, terms);
    for (const term of terms) {
      if (!this.postings.has(term)) this.postings.set(term, new Set());
      this.postings.get(term).add(id);
    }
  }

  search(term) {
    return [...(this.postings.get(term.toLowerCase()) ?? [])].sort(byCode);
  }

  removeDoc(id) {
    const terms = this.docs.get(id);
    if (terms === undefined) return false;
    this.docs.delete(id);
    for (const term of terms) this.postings.get(term).delete(id);
    return true;
  }

  size() {
    return this.docs.size;
  }
}

// A virtual proxy: it answers like the index, but holds only the raw documents until the
// first search needs the real one. After that, every change goes straight to the real
// index, one document at a time, so it's never built twice.
class LazyIndex {
  constructor() {
    this.pending = new Map();
    this.index = null;
    this.buildCount = 0;
  }

  real() {
    if (this.index === null) {
      this.index = new InvertedIndex(this.pending);
      this.buildCount += 1;
    }
    return this.index;
  }

  addDoc(id, text) {
    if (id === "" || text === "") throw new RangeError("empty");
    if (this.index === null) this.pending.set(id, text);
    else this.index.addDoc(id, text);
  }

  search(term) {
    if (!/^[A-Za-z0-9]+$/.test(term))
      throw new RangeError("a term is letters and digits");
    return this.real().search(term);
  }

  builds() {
    return this.buildCount;
  }

  indexed() {
    return this.index === null ? 0 : this.index.size();
  }

  // The extension round: documents leave without a rebuild either.
  removeDoc(id) {
    if (id === "") throw new RangeError("empty");
    if (this.index === null) return this.pending.delete(id);
    return this.index.removeDoc(id);
  }
}

module.exports = { LazyIndex };
