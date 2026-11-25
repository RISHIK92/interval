"use strict";

const MAX_UNITS = 1e9;
const MAX_MINIMUM_CENTS = 1e9;
const MAX_RATE = 1e6;
const MAX_TIERS = 10;

function checkedTiers(tiers) {
  if (
    tiers.length < 1 ||
    tiers.length > MAX_TIERS ||
    tiers.some((t) => t.length !== 2)
  )
    throw new RangeError("1-10 tiers, each [start, centsPerUnit]");
  if (
    tiers[0][0] !== 0 ||
    tiers.some((t, i) => i > 0 && t[0] <= tiers[i - 1][0]) ||
    tiers[tiers.length - 1][0] > MAX_UNITS
  )
    throw new RangeError("starts begin at 0 and rise, up to 10^9");
  if (tiers.some((t) => t[1] < 0 || t[1] > MAX_RATE))
    throw new RangeError("rates within 0-10^6");
  return tiers.map((t) => ({ start: t[0], rate: t[1] }));
}

// How a metric turns a customer's units into cents.
class Graduated {
  constructor(tiers) {
    this.tiers = tiers;
  }

  charge(units) {
    let total = 0;
    let left = units;
    for (const { start, rate } of [...this.tiers].reverse()) {
      const above = Math.max(left - start, 0);
      total += above * rate;
      left -= above;
    }
    return total;
  }
}

class Volume {
  constructor(tiers) {
    this.tiers = tiers;
  }

  charge(units) {
    const tier = [...this.tiers].reverse().find((t) => t.start < units);
    return units * tier.rate;
  }
}

const MODELS = new Map([
  ["graduated", Graduated],
  ["volume", Volume],
]);

class UsageBilling {
  #pricing = new Map();
  #minimums = new Map();
  #usage = new Map();

  price(metric, model, tiers) {
    const Model = MODELS.get(model);
    if (metric === "" || Model === undefined)
      throw new RangeError("a named metric and a known model");
    this.#pricing.set(metric, new Model(checkedTiers(tiers)));
  }

  meter(customer, metric, units) {
    if (
      customer === "" ||
      !this.#pricing.has(metric) ||
      units < 1 ||
      units > MAX_UNITS
    )
      throw new RangeError("a customer, a priced metric and 1-10^9 units");
    let used = this.#usage.get(customer);
    if (used === undefined) {
      used = new Map();
      this.#usage.set(customer, used);
    }
    used.set(metric, (used.get(metric) ?? 0) + units);
  }

  #line(metric, units) {
    const charge = this.#pricing.get(metric).charge(units);
    const least = this.#minimums.get(metric);
    return least === undefined ? charge : Math.max(charge, least);
  }

  invoice(customer) {
    return Object.fromEntries(
      [...(this.#usage.get(customer) ?? [])].map(([metric, units]) => [
        metric,
        this.#line(metric, units),
      ]),
    );
  }

  total(customer) {
    return Object.values(this.invoice(customer)).reduce((a, b) => a + b, 0);
  }

  // The extension round.
  minimum(metric, cents) {
    if (!this.#pricing.has(metric) || cents < 0 || cents > MAX_MINIMUM_CENTS)
      throw new RangeError("a priced metric and 0-10^9 cents");
    this.#minimums.set(metric, cents);
  }
}

module.exports = { UsageBilling };
