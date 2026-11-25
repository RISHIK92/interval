"use strict";

const MAX_STEP = 1e9;
const MAX_READING = 1e12;

// Character-code order, whatever the runtime's locale.
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class MetricRegistry {
  #counters = new Map();
  #gauges = new Map();

  // A name belongs to one kind for good: the other kind's map must not hold it.
  static #claim(name, other) {
    if (name === "" || other.has(name))
      throw new RangeError("a metric needs a non-empty name of its own kind");
  }

  inc(name, by) {
    if (by < 1 || by > MAX_STEP)
      throw new RangeError("a counter goes up by 1 to 10^9");
    MetricRegistry.#claim(name, this.#gauges);
    const value = (this.#counters.get(name) ?? 0) + by;
    this.#counters.set(name, value);
    return value;
  }

  gauge(name, value) {
    if (value < -MAX_READING || value > MAX_READING)
      throw new RangeError("a gauge reads within -10^12 and 10^12");
    MetricRegistry.#claim(name, this.#counters);
    this.#gauges.set(name, value);
  }

  read(name) {
    return this.#counters.get(name) ?? this.#gauges.get(name) ?? null;
  }

  names() {
    return [...this.#counters.keys(), ...this.#gauges.keys()].sort(byCode);
  }

  // The extension round.
  snapshotAndReset() {
    const snapshot = Object.fromEntries(this.#counters);
    for (const name of this.#counters.keys()) this.#counters.set(name, 0);
    return snapshot;
  }
}

module.exports = { MetricRegistry };
