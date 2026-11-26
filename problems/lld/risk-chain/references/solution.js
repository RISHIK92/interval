"use strict";

const WINDOW_MS = 60_000;

// What the checks may look at besides the payment: shared by the whole chain.
class History {
  constructor() {
    this.blocked = new Set();
    this.home = new Map();
    this.recent = new Map();
  }

  remember(p) {
    if (!this.home.has(p.customer)) this.home.set(p.customer, p.country);
    const times = this.recent.get(p.customer) ?? [];
    times.push(p.nowMs);
    // Times never decrease, so the ones that left the window are at the front.
    const kept = times.findIndex((t) => t > p.nowMs - WINDOW_MS);
    this.recent.set(p.customer, times.slice(kept));
  }

  count(customer) {
    return this.recent.get(customer)?.length ?? 0;
  }
}

// Links of the chain: decide(payment, history) gives a verdict, or null to pass the
// payment to the next link.
class Blocklist {
  constructor() {
    this.kind = "blocklist";
  }

  decide(p, history) {
    return history.blocked.has(p.customer) ? "block" : null;
  }
}

class Velocity {
  constructor(most) {
    this.kind = "velocity";
    this.most = most;
  }

  decide(p, history) {
    return history.count(p.customer) > this.most ? "review" : null;
  }
}

class AmountLimit {
  constructor(limit) {
    this.kind = "amount";
    this.limit = limit;
  }

  decide(p) {
    return p.cents > this.limit ? "block" : null;
  }
}

class CountryMismatch {
  constructor() {
    this.kind = "country";
  }

  decide(p, history) {
    return history.home.get(p.customer) !== p.country ? "review" : null;
  }
}

// Each kind with the least param it accepts; blocklist and country take none, so only 0.
const KINDS = new Map([
  ["blocklist", { make: () => new Blocklist(), low: 0, takes: false }],
  ["velocity", { make: (n) => new Velocity(n), low: 1, takes: true }],
  ["amount", { make: (n) => new AmountLimit(n), low: 0, takes: true }],
  ["country", { make: () => new CountryMismatch(), low: 0, takes: false }],
]);

class RiskChain {
  constructor() {
    this.checks = [];
    this.history = new History();
    this.counts = new Map([
      ["allow", 0],
      ["review", 0],
      ["block", 0],
    ]);
    this.skips = new Set();
  }

  addCheck(check, param) {
    const kind = KINDS.get(check);
    if (kind === undefined) throw new Error("unknown check");
    if (param < kind.low || (param !== kind.low && !kind.takes))
      throw new Error("param out of range");
    this.checks.push(kind.make(param));
  }

  block(customer) {
    if (customer === "") throw new Error("empty customer");
    this.history.blocked.add(customer);
  }

  assess(customer, cents, country, nowMs) {
    if (customer === "" || country === "" || cents < 1)
      throw new Error("bad payment");
    const p = { customer, cents, country, nowMs };
    this.history.remember(p);
    let verdict = "allow";
    for (const check of this.checks) {
      if (this.skips.has(JSON.stringify([customer, check.kind]))) continue;
      const decided = check.decide(p, this.history);
      if (decided !== null) {
        verdict = decided;
        break;
      }
    }
    this.counts.set(verdict, this.counts.get(verdict) + 1);
    return verdict;
  }

  decisions(verdict) {
    const count = this.counts.get(verdict);
    if (count === undefined) throw new Error("unknown verdict");
    return count;
  }

  // The extension round: trusted customers skip a kind of check.
  skipFor(customer, check) {
    if (customer === "" || !KINDS.has(check)) throw new Error("bad skip");
    const key = JSON.stringify([customer, check]);
    if (this.skips.has(key)) return false;
    this.skips.add(key);
    return true;
  }
}

module.exports = { RiskChain };
