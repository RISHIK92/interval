"use strict";

const MAX_VERSION = 10 ** 9;

// A broken precondition fails the call before anything changes.
function precondition(condition, why) {
  if (!condition) throw new RangeError(why);
}

// How many of the sorted versions are at or below `version`.
function countUpTo(versions, version) {
  let n = 0;
  while (n < versions.length && versions[n] <= version) n += 1;
  return n;
}

// Invariant: the applied migrations are exactly the lowest `#applied` versions, so the
// current version is the last of them and everything above it is pending.
class MigrationPlan {
  #names = new Map();
  #versions = [];
  #applied = 0;
  #irreversible = new Set();

  add(version, name) {
    precondition(
      version >= 1 && version <= MAX_VERSION,
      "versions are within 1 and 10^9",
    );
    precondition(name !== "", "a migration has a name");
    precondition(!this.#names.has(version), "that version is already planned");
    // It must land above every applied migration, or it could never be applied.
    precondition(
      version > this.current(),
      "that version is below the current one",
    );
    this.#names.set(version, name);
    this.#versions.splice(countUpTo(this.#versions, version), 0, version);
  }

  applyUpTo(version) {
    precondition(this.#names.has(version), "unknown version");
    precondition(version >= this.current(), "applying never goes down");
    const start = this.#applied;
    this.#applied = countUpTo(this.#versions, version);
    return this.#versions
      .slice(start, this.#applied)
      .map((v) => this.#names.get(v));
  }

  rollback(steps) {
    precondition(
      steps >= 1 && steps <= this.#applied,
      "steps are within 1 and the applied count",
    );
    const undone = this.#versions
      .slice(this.#applied - steps, this.#applied)
      .reverse();
    precondition(
      !undone.some((v) => this.#irreversible.has(v)),
      "an irreversible migration is in the way",
    );
    this.#applied -= steps;
    return undone.map((v) => this.#names.get(v));
  }

  current() {
    return this.#applied > 0 ? this.#versions[this.#applied - 1] : 0;
  }

  pending() {
    return this.#versions.slice(this.#applied);
  }

  // The extension round: one more precondition on rollback.
  irreversible(version) {
    precondition(this.#names.has(version), "unknown version");
    this.#irreversible.add(version);
  }
}

module.exports = { MigrationPlan };
