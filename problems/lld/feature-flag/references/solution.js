"use strict";

function checkedPercent(percent) {
  if (percent < 0 || percent > 100)
    throw new RangeError("percent must be within 0-100");
  return percent;
}

function checkedBucket(bucket) {
  if (bucket < 0 || bucket > 99)
    throw new RangeError("bucket must be within 0-99");
  return bucket;
}

class FeatureFlag {
  #name;
  #percent;
  #killed = false;
  #allowed = new Set();

  constructor(name, rolloutPercent) {
    if (name === "") throw new RangeError("a flag needs a name");
    this.#name = name;
    this.#percent = checkedPercent(rolloutPercent);
  }

  enabledFor(userBucket) {
    const bucket = checkedBucket(userBucket);
    if (this.#killed) return false;
    return this.#allowed.has(bucket) || bucket < this.#percent;
  }

  setRollout(percent) {
    this.#percent = checkedPercent(percent);
  }

  kill() {
    this.#killed = true;
  }

  revive() {
    this.#killed = false;
  }

  // The extension round.
  allow(userBucket) {
    this.#allowed.add(checkedBucket(userBucket));
  }
}

module.exports = { FeatureFlag };
