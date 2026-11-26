const MOST_SHARDS = 1000;
const MODULUS = 1_000_000_007;

// How a key finds its shard; null when this strategy has no shard for it.
interface Strategy {
  shard(key: string, shards: number): number | null;
}

class HashModulo implements Strategy {
  shard(key: string, shards: number): number {
    let h = 0;
    for (let i = 0; i < key.length; i++)
      h = (h * 31 + key.charCodeAt(i)) % MODULUS;
    return h % shards;
  }
}

class KeyRange implements Strategy {
  shard(key: string, shards: number): number {
    // Printable ASCII split into equal ranges by the first character.
    return Math.floor(((key.charCodeAt(0) - 32) * shards) / 95);
  }
}

class Directory implements Strategy {
  private readonly entries: ReadonlyMap<string, number>;

  constructor(entries: ReadonlyMap<string, number>) {
    this.entries = entries;
  }

  shard(key: string): number | null {
    return this.entries.get(key) ?? null;
  }
}

function checkCount(shards: number): void {
  if (shards < 1 || shards > MOST_SHARDS)
    throw new Error("shards out of range");
}

function checkKey(key: string): string {
  if (key === "") throw new Error("empty key");
  return key;
}

export class ShardRouter {
  private shards: number;
  private readonly directory = new Map<string, number>();
  private readonly strategies = new Map<string, Strategy>([
    ["hash", new HashModulo()],
    ["range", new KeyRange()],
    ["directory", new Directory(this.directory)],
  ]);
  private strategy: Strategy;
  private readonly tracked = new Set<string>();

  constructor(shards: number, strategy: string) {
    checkCount(shards);
    this.shards = shards;
    this.strategy = this.pick(strategy);
  }

  route(key: string): number {
    const shard = this.strategy.shard(checkKey(key), this.shards);
    if (shard === null) throw new Error("no directory entry");
    return shard;
  }

  track(key: string): void {
    this.tracked.add(checkKey(key));
  }

  assignDirectory(key: string, shard: number): void {
    checkKey(key);
    if (shard < 0 || shard >= this.shards) throw new Error("no such shard");
    this.directory.set(key, shard);
  }

  rebalance(shards: number): number {
    checkCount(shards);
    const before = this.placement();
    this.shards = shards;
    for (const [key, at] of this.directory)
      this.directory.set(key, at % shards);
    return this.moved(before);
  }

  // The extension round: switching strategy, reporting what moves.
  useStrategy(strategy: string): number {
    const chosen = this.pick(strategy);
    const before = this.placement();
    this.strategy = chosen;
    return this.moved(before);
  }

  private pick(strategy: string): Strategy {
    const found = this.strategies.get(strategy);
    if (found === undefined) throw new Error("unknown strategy");
    return found;
  }

  private placement(): Map<string, number | null> {
    return new Map(
      [...this.tracked].map((key) => [
        key,
        this.strategy.shard(key, this.shards),
      ]),
    );
  }

  private moved(before: Map<string, number | null>): number {
    const after = this.placement();
    return [...this.tracked].filter((key) => before.get(key) !== after.get(key))
      .length;
  }
}
