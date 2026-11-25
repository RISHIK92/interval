"use strict";

const MAX_ATTEMPTS = 1000;
const MAX_CAP_MS = 1_000_000_000;

// The one thing that varies between schedules: the delay before an attempt, at most
// `cap`. Growth stops at the cap, so no kind ever overflows.
const fixed = { delay: (_attempt, base) => base };

const linear = {
  delay: (attempt, base, cap) => Math.min(base * attempt, cap),
};

const exponential = {
  delay(attempt, base, cap) {
    let d = base;
    for (let a = 1; a < attempt && d < cap; a++) d *= 2;
    return Math.min(d, cap);
  },
};

const fibonacci = {
  delay(attempt, base, cap) {
    let previous = 0;
    let current = base;
    for (let a = 1; a < attempt && current < cap; a++)
      [previous, current] = [current, previous + current];
    return Math.min(current, cap);
  },
};

const KINDS = new Map([
  ["fixed", fixed],
  ["linear", linear],
  ["exponential", exponential],
]);

function growthOf(kind) {
  const growth = KINDS.get(kind);
  if (growth === undefined) throw new RangeError("unknown kind");
  return growth;
}

function count(n, low) {
  if (n < low || n > MAX_ATTEMPTS)
    throw new RangeError("attempts out of range");
}

// Caps, schedules and totals are the same for every kind; only the growth is swapped.
class BackoffSchedule {
  #growth;
  #base;
  #cap;

  constructor(kind, baseMs, capMs) {
    const growth = growthOf(kind);
    if (baseMs < 1 || capMs < baseMs || capMs > MAX_CAP_MS)
      throw new RangeError("1 <= baseMs <= capMs <= 10^9");
    this.#growth = growth;
    this.#base = baseMs;
    this.#cap = capMs;
  }

  delay(attempt) {
    count(attempt, 1);
    return this.#growth.delay(attempt, this.#base, this.#cap);
  }

  schedule(attempts) {
    count(attempts, 0);
    return Array.from({ length: attempts }, (_, i) => this.delay(i + 1));
  }

  totalMs(attempts) {
    return this.schedule(attempts).reduce((sum, d) => sum + d, 0);
  }

  switchTo(kind) {
    this.#growth = growthOf(kind);
  }

  // The extension round: one more growth, and nothing else changes.
  fibonacci() {
    this.#growth = fibonacci;
  }
}

module.exports = { BackoffSchedule };
