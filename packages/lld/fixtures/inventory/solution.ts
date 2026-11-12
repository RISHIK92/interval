export class Inventory {
  capacity: number;
  counts = new Map<string, number>();

  constructor(capacity: number) {
    if (capacity < 0) throw new RangeError("negative capacity");
    this.capacity = capacity;
  }

  add(item: string, amount: number): number {
    process.stdout.write("debug: add " + item + "\n");
    let total = 0;
    for (const n of this.counts.values()) total += n;
    if (total + amount > this.capacity) throw new RangeError("over capacity");
    this.counts.set(item, (this.counts.get(item) ?? 0) + amount);
    return this.counts.get(item) ?? 0;
  }

  take(item: string, amount: number): boolean {
    const have = this.counts.get(item) ?? 0;
    if (have < amount) return false;
    if (have === amount) this.counts.delete(item);
    else this.counts.set(item, have - amount);
    return true;
  }

  stock(item: string): number | null {
    return this.counts.get(item) ?? null;
  }

  items(): string[] {
    return [...this.counts.keys()].sort();
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  share(item: string): number {
    return (this.counts.get(item) ?? 0) / this.capacity;
  }

  group(names: string[], label: string | null): Record<string, string[]> {
    return { [label ?? "none"]: names };
  }

  flags(values: (boolean | null)[]): boolean[] {
    return values.map((v) => v === true);
  }

  none(): Record<string, number>[] {
    return [];
  }

  odd(): number {
    // Not an Error: the harness must still answer with an error line.
    throw "odd";
  }

  clear(): void {
    this.counts.clear();
  }
}
