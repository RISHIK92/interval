export class DiskQuota {
  private readonly limit: number;
  private total = 0;
  // Only owners holding more than 0 bytes.
  private readonly held = new Map<string, number>();
  private soft: number | null = null;

  constructor(limitBytes: number) {
    if (limitBytes < 0) throw new RangeError("the limit can't be negative");
    this.limit = limitBytes;
  }

  reserve(owner: string, bytes: number): boolean {
    if (bytes < 1) throw new RangeError("reserve at least one byte");
    // Compared by subtraction: a sum past 2^53 would round.
    if (bytes > this.limit - this.total) return false;
    this.held.set(owner, this.used(owner) + bytes);
    this.total += bytes;
    return true;
  }

  release(owner: string, bytes: number): void {
    if (bytes < 1) throw new RangeError("release at least one byte");
    const held = this.used(owner);
    if (bytes > held) throw new RangeError("more than the owner holds");
    if (held === bytes) this.held.delete(owner);
    else this.held.set(owner, held - bytes);
    this.total -= bytes;
  }

  used(owner: string): number {
    return this.held.get(owner) ?? 0;
  }

  free(): number {
    return this.limit - this.total;
  }

  // The extension round.
  softLimit(bytes: number): void {
    if (bytes < 0) throw new RangeError("the soft limit can't be negative");
    this.soft = bytes;
  }

  warnings(): string[] {
    const soft = this.soft;
    if (soft === null) return [];
    return [...this.held]
      .filter(([, held]) => held > soft)
      .map(([owner]) => owner)
      .sort();
  }
}
