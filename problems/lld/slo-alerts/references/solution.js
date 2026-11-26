"use strict";

const PERMILLE = 1000;
const PERCENT = 100;

// An observer of one service. It speaks only when the service's burn crosses its
// threshold, in either direction, so it never repeats itself.
class Watcher {
  #alerting = false;

  constructor(subscriber, threshold) {
    this.subscriber = subscriber;
    this.threshold = threshold;
  }

  update(burned) {
    const burning = burned >= this.threshold;
    if (burning === this.#alerting) return null;
    this.#alerting = burning;
    return `${this.subscriber} ${burning ? "burning" : "recovered"}`;
  }
}

// The subject: its request counts, and the watchers it tells after each change.
class Service {
  good = 0;
  bad = 0;
  watchers = new Map();

  burned(allowed) {
    const total = this.good + this.bad;
    if (total === 0) return 0;
    return Math.floor((this.bad * PERMILLE * PERCENT) / (total * allowed));
  }
}

class SloMonitor {
  // The error budget: how many requests in a thousand may fail.
  #allowed;
  #services = new Map();

  constructor(objectivePermille) {
    if (objectivePermille <= 0 || objectivePermille >= PERMILLE)
      throw new RangeError("an objective from 1 to 999 permille");
    this.#allowed = PERMILLE - objectivePermille;
  }

  #service(name) {
    if (!this.#services.has(name)) this.#services.set(name, new Service());
    return this.#services.get(name);
  }

  watch(subscriber, service, burnPercent) {
    if (
      subscriber === "" ||
      service === "" ||
      burnPercent <= 0 ||
      burnPercent > PERCENT
    )
      throw new RangeError("an empty name or a threshold outside 1 to 100");
    const watchers = this.#service(service).watchers;
    const known = watchers.get(subscriber);
    if (known !== undefined) known.threshold = burnPercent;
    else watchers.set(subscriber, new Watcher(subscriber, burnPercent));
  }

  observe(service, good, bad) {
    if (service === "" || good < 0 || bad < 0)
      throw new RangeError("an empty service or a negative count");
    const subject = this.#service(service);
    subject.good += good;
    subject.bad += bad;
    const burned = subject.burned(this.#allowed);
    const told = [];
    for (const watcher of subject.watchers.values()) {
      const message = watcher.update(burned);
      if (message !== null) told.push(message);
    }
    return told;
  }

  budgetLeft(service) {
    if (service === "") throw new RangeError("an empty service");
    return PERCENT - (this.#services.get(service)?.burned(this.#allowed) ?? 0);
  }

  // The extension round: a watcher leaves, and coming back starts afresh at the end.
  unwatch(subscriber, service) {
    if (subscriber === "" || service === "")
      throw new RangeError("an empty name");
    return this.#services.get(service)?.watchers.delete(subscriber) ?? false;
  }
}

module.exports = { SloMonitor };
