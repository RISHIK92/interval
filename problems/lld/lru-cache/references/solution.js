"use strict";

class LRUCache {
  constructor(capacity) {
    if (capacity < 1) throw new RangeError("capacity must be at least 1");
    this.capacity = capacity;
    // A Map keeps insertion order: the first key is the least recently used.
    this.entries = new Map();
  }

  lookup(key) {
    if (!this.entries.has(key)) return null;
    const value = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  put(key, value) {
    if (value < 0) throw new RangeError("negative value");
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value);
  }

  size() {
    return this.entries.size;
  }

  keys() {
    return [...this.entries.keys()].reverse();
  }

  // The extension round.
  resize(capacity) {
    if (capacity < 1) throw new RangeError("capacity must be at least 1");
    this.capacity = capacity;
    while (this.entries.size > capacity)
      this.entries.delete(this.entries.keys().next().value);
  }

  peek(key) {
    return this.entries.get(key) ?? null;
  }
}

module.exports = { LRUCache };
