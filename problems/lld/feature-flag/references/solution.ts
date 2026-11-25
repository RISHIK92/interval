function checkedPercent(percent: number): number {
  if (percent < 0 || percent > 100)
    throw new RangeError("percent must be within 0-100");
  return percent;
}

function checkedBucket(bucket: number): number {
  if (bucket < 0 || bucket > 99)
    throw new RangeError("bucket must be within 0-99");
  return bucket;
}

export class FeatureFlag {
  private readonly name: string;
  private percent: number;
  private killed = false;
  private readonly allowed = new Set<number>();

  constructor(name: string, rolloutPercent: number) {
    if (name === "") throw new RangeError("a flag needs a name");
    this.name = name;
    this.percent = checkedPercent(rolloutPercent);
  }

  enabledFor(userBucket: number): boolean {
    const bucket = checkedBucket(userBucket);
    if (this.killed) return false;
    return this.allowed.has(bucket) || bucket < this.percent;
  }

  setRollout(percent: number): void {
    this.percent = checkedPercent(percent);
  }

  kill(): void {
    this.killed = true;
  }

  revive(): void {
    this.killed = false;
  }

  // The extension round.
  allow(userBucket: number): void {
    this.allowed.add(checkedBucket(userBucket));
  }
}
