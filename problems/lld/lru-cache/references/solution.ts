export class LRUCache {
  private readonly capacity: number;
  // A Map keeps insertion order: the first key is the least recently used.
  private readonly entries = new Map<string, number>();

  constructor(capacity: number) {
    if (capacity < 1) throw new RangeError("capacity must be at least 1");
    this.capacity = capacity;
  }

  lookup(key: string): number | null {
    const value = this.entries.get(key);
    if (value === undefined) return null;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  put(key: string, value: number): void {
    if (value < 0) throw new RangeError("negative value");
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  size(): number {
    return this.entries.size;
  }

  keys(): string[] {
    return [...this.entries.keys()].reverse();
  }
}
