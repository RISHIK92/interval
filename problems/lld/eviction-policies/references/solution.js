"use strict";

// Each strategy only ranks entries (a cached value and its usage history); the lowest
// rank is evicted. Every policy reads the same history, so switching never loses it.
const POLICIES = new Map([
  ["lru", { rank: (e) => [e.used] }],
  ["lfu", { rank: (e) => [e.uses, e.used] }],
  ["fifo", { rank: (e) => [e.entered] }],
]);

function before(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

class EvictingCache {
  #capacity;
  #policy;
  #entries = new Map();
  #pinned = new Set();
  #clock = 0;

  constructor(capacity, policy) {
    if (capacity < 1 || !POLICIES.has(policy))
      throw new RangeError("bad capacity or policy");
    this.#capacity = capacity;
    this.#policy = POLICIES.get(policy);
  }

  #use(entry) {
    entry.used = ++this.#clock;
    entry.uses++;
  }

  #evict() {
    let victim = null;
    let lowest = [];
    for (const [key, entry] of this.#entries) {
      if (this.#pinned.has(key)) continue;
      const rank = this.#policy.rank(entry);
      if (victim === null || before(rank, lowest)) {
        victim = key;
        lowest = rank;
      }
    }
    if (victim === null) throw new RangeError("every key is pinned");
    this.#entries.delete(victim);
  }

  put(key, val) {
    if (key === "") throw new RangeError("an empty key");
    const entry = this.#entries.get(key);
    if (entry !== undefined) {
      entry.value = val;
      this.#use(entry);
      return;
    }
    if (this.#entries.size >= this.#capacity) this.#evict();
    const stamp = ++this.#clock;
    this.#entries.set(key, {
      value: val,
      entered: stamp,
      used: stamp,
      uses: 1,
    });
  }

  lookup(key) {
    if (key === "") throw new RangeError("an empty key");
    const entry = this.#entries.get(key);
    if (entry === undefined) return null;
    this.#use(entry);
    return entry.value;
  }

  keys() {
    return [...this.#entries.keys()].sort();
  }

  switchPolicy(policy) {
    if (!POLICIES.has(policy)) throw new RangeError("unknown policy");
    this.#policy = POLICIES.get(policy);
  }

  // The extension round: a pinned key is passed over by every policy.
  pinKey(key) {
    if (!this.#entries.has(key)) throw new RangeError("not cached");
    this.#pinned.add(key);
  }
}

module.exports = { EvictingCache };
