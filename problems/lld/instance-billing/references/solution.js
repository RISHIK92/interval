"use strict";

const MAX_RATE = 1e6;
const MAX_HOURS = 1e4;

// One instance: the hours it has run. Each kind turns them into cents its own way.
class Instance {
  constructor(hourly) {
    this.hourly = hourly;
    this.hours = 0;
  }

  run(hours) {
    this.hours += hours;
  }

  interrupt() {
    throw new RangeError("only a spot instance can be interrupted");
  }
}

class OnDemand extends Instance {
  bill() {
    return this.hours * this.hourly;
  }
}

class Reserved extends Instance {
  // 100 hours paid up front, then 60% of the rate over all the hours run.
  bill() {
    return (
      100 * this.hourly + Math.floor((this.hours * this.hourly * 60) / 100)
    );
  }
}

class Spot extends Instance {
  interrupted = false;

  // Once interrupted, runs are still accepted but no longer billed.
  run(hours) {
    if (!this.interrupted) super.run(hours);
  }

  bill() {
    return Math.floor((this.hours * this.hourly * 30) / 100);
  }

  interrupt() {
    const first = !this.interrupted;
    this.interrupted = true;
    return first;
  }
}

class Dedicated extends Instance {
  constructor(hourly, hostFee) {
    super(hourly);
    this.hostFee = hostFee;
    this.runs = 0;
  }

  run(hours) {
    super.run(hours);
    this.runs += 1;
  }

  bill() {
    return this.hours * this.hourly + this.runs * this.hostFee;
  }
}

const KINDS = new Map([
  ["on-demand", OnDemand],
  ["reserved", Reserved],
  ["spot", Spot],
]);

function rate(cents) {
  if (cents < 1 || cents > MAX_RATE)
    throw new RangeError("hourlyCents must be within 1 and 10^6");
  return cents;
}

class BillingMeter {
  #instances = new Map();

  #add(id, instance) {
    if (id === "" || this.#instances.has(id))
      throw new RangeError("an instance needs a new, non-empty id");
    this.#instances.set(id, instance);
  }

  #find(id) {
    const instance = this.#instances.get(id);
    if (instance === undefined) throw new RangeError("no such instance");
    return instance;
  }

  launch(id, kind, hourlyCents) {
    const Kind = KINDS.get(kind);
    if (Kind === undefined) throw new RangeError("unknown kind");
    this.#add(id, new Kind(rate(hourlyCents)));
  }

  run(id, hours) {
    if (hours < 1 || hours > MAX_HOURS)
      throw new RangeError("hours must be within 1 and 10^4");
    this.#find(id).run(hours);
  }

  bill(id) {
    return this.#find(id).bill();
  }

  total() {
    let sum = 0;
    for (const instance of this.#instances.values()) sum += instance.bill();
    return sum;
  }

  interrupt(id) {
    return this.#find(id).interrupt();
  }

  // The extension round: a fourth kind, added without touching the others.
  launchDedicated(id, hourlyCents, hostFeeCents) {
    if (hostFeeCents < 0 || hostFeeCents > MAX_RATE)
      throw new RangeError("hostFeeCents must be within 0 and 10^6");
    this.#add(id, new Dedicated(rate(hourlyCents), hostFeeCents));
  }
}

module.exports = { BillingMeter };
