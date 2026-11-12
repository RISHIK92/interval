class Inventory {
  constructor(capacity) {
    if (capacity < 0) throw new RangeError("negative capacity");
    this.capacity = capacity;
    this.counts = new Map();
    // The extension round: units held back, which take may not take.
    this.held = new Map();
  }

  add(item, amount) {
    if (amount <= 0) throw new RangeError("amount must be positive");
    console.log("debug: add", item);
    let total = 0;
    for (const n of this.counts.values()) total += n;
    if (total + amount > this.capacity) throw new RangeError("over capacity");
    this.counts.set(item, (this.counts.get(item) ?? 0) + amount);
    return this.counts.get(item);
  }

  take(item, amount) {
    if (amount <= 0) throw new RangeError("amount must be positive");
    const have = this.counts.get(item) ?? 0;
    if (have - (this.held.get(item) ?? 0) < amount) return false;
    if (have === amount) this.counts.delete(item);
    else this.counts.set(item, have - amount);
    return true;
  }

  stock(item) {
    return this.counts.get(item) ?? null;
  }

  items() {
    return [...this.counts.keys()].sort();
  }

  snapshot() {
    return Object.fromEntries(this.counts);
  }

  share(item) {
    return (this.counts.get(item) ?? 0) / this.capacity;
  }

  group(names, label) {
    return { [label ?? "none"]: names };
  }

  flags(values) {
    return values.map((v) => v === true);
  }

  none() {
    return [];
  }

  odd() {
    // Not an Error: the harness must still answer with an error line.
    throw "odd";
  }

  clear() {
    this.counts.clear();
    this.held.clear();
  }

  reserve(item, amount) {
    if (amount <= 0) throw new RangeError("amount must be positive");
    const free = (this.counts.get(item) ?? 0) - (this.held.get(item) ?? 0);
    if (free < amount) return false;
    this.held.set(item, (this.held.get(item) ?? 0) + amount);
    return true;
  }

  reserved(item) {
    return this.held.get(item) ?? 0;
  }
}

module.exports = { Inventory };
