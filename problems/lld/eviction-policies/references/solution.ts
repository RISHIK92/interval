// A cached value and its usage history. Every policy reads the same history, so
// switching never loses it.
interface Entry {
  value: number;
  entered: number;
  used: number;
  uses: number;
}

// Each strategy only ranks entries; the lowest rank is evicted.
interface Policy {
  rank(entry: Entry): number[];
}

const POLICIES = new Map<string, Policy>([
  ["lru", { rank: (e) => [e.used] }],
  ["lfu", { rank: (e) => [e.uses, e.used] }],
  ["fifo", { rank: (e) => [e.entered] }],
]);

function before(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export class EvictingCache {
  private readonly capacity: number;
  private policy: Policy;
  private readonly entries = new Map<string, Entry>();
  private readonly pinned = new Set<string>();
  private clock = 0;

  constructor(capacity: number, policy: string) {
    const chosen = POLICIES.get(policy);
    if (capacity < 1 || chosen === undefined)
      throw new RangeError("bad capacity or policy");
    this.capacity = capacity;
    this.policy = chosen;
  }

  private use(entry: Entry): void {
    entry.used = ++this.clock;
    entry.uses++;
  }

  private evict(): void {
    let victim: string | null = null;
    let lowest: number[] = [];
    for (const [key, entry] of this.entries) {
      if (this.pinned.has(key)) continue;
      const rank = this.policy.rank(entry);
      if (victim === null || before(rank, lowest)) {
        victim = key;
        lowest = rank;
      }
    }
    if (victim === null) throw new RangeError("every key is pinned");
    this.entries.delete(victim);
  }

  put(key: string, val: number): void {
    if (key === "") throw new RangeError("an empty key");
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      entry.value = val;
      this.use(entry);
      return;
    }
    if (this.entries.size >= this.capacity) this.evict();
    const stamp = ++this.clock;
    this.entries.set(key, { value: val, entered: stamp, used: stamp, uses: 1 });
  }

  lookup(key: string): number | null {
    if (key === "") throw new RangeError("an empty key");
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    this.use(entry);
    return entry.value;
  }

  keys(): string[] {
    return [...this.entries.keys()].sort();
  }

  switchPolicy(policy: string): void {
    const chosen = POLICIES.get(policy);
    if (chosen === undefined) throw new RangeError("unknown policy");
    this.policy = chosen;
  }

  // The extension round: a pinned key is passed over by every policy.
  pinKey(key: string): void {
    if (!this.entries.has(key)) throw new RangeError("not cached");
    this.pinned.add(key);
  }
}
