"use strict";

const MOST_SHARDS = 1000;
const MODULUS = 1_000_000_007;

// Strategies: shard(key, shards) gives the key's shard, or null when this strategy has
// no shard for it.
class HashModulo {
  shard(key, shards) {
    let h = 0;
    for (let i = 0; i < key.length; i++)
      h = (h * 31 + key.charCodeAt(i)) % MODULUS;
    return h % shards;
  }
}

class KeyRange {
  shard(key, shards) {
    // Printable ASCII split into equal ranges by the first character.
    return Math.floor(((key.charCodeAt(0) - 32) * shards) / 95);
  }
}

class Directory {
  constructor(entries) {
    this.entries = entries;
  }

  shard(key) {
    return this.entries.get(key) ?? null;
  }
}

function checkCount(shards) {
  if (shards < 1 || shards > MOST_SHARDS)
    throw new Error("shards out of range");
}

function checkKey(key) {
  if (key === "") throw new Error("empty key");
  return key;
}

class ShardRouter {
  constructor(shards, strategy) {
    checkCount(shards);
    this.shards = shards;
    this.directory = new Map();
    this.strategies = new Map([
      ["hash", new HashModulo()],
      ["range", new KeyRange()],
      ["directory", new Directory(this.directory)],
    ]);
    this.strategy = this.pick(strategy);
    this.tracked = new Set();
  }

  route(key) {
    const shard = this.strategy.shard(checkKey(key), this.shards);
    if (shard === null) throw new Error("no directory entry");
    return shard;
  }

  track(key) {
    this.tracked.add(checkKey(key));
  }

  assignDirectory(key, shard) {
    checkKey(key);
    if (shard < 0 || shard >= this.shards) throw new Error("no such shard");
    this.directory.set(key, shard);
  }

  rebalance(shards) {
    checkCount(shards);
    const before = this.placement();
    this.shards = shards;
    for (const [key, at] of this.directory)
      this.directory.set(key, at % shards);
    return this.moved(before);
  }

  // The extension round: switching strategy, reporting what moves.
  useStrategy(strategy) {
    const chosen = this.pick(strategy);
    const before = this.placement();
    this.strategy = chosen;
    return this.moved(before);
  }

  pick(strategy) {
    const found = this.strategies.get(strategy);
    if (found === undefined) throw new Error("unknown strategy");
    return found;
  }

  placement() {
    return new Map(
      [...this.tracked].map((key) => [
        key,
        this.strategy.shard(key, this.shards),
      ]),
    );
  }

  moved(before) {
    const after = this.placement();
    return [...this.tracked].filter((key) => before.get(key) !== after.get(key))
      .length;
  }
}

module.exports = { ShardRouter };
