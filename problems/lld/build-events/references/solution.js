"use strict";

const EVENTS = new Set(["queued", "started", "passed", "failed"]);

function given(value) {
  if (value === "") throw new RangeError("empty");
}

function checkEvent(event) {
  if (!EVENTS.has(event)) throw new RangeError("unknown event");
}

// An observer: it takes delivery of the events it chose. While paused it keeps them
// back, in order, until it's resumed.
class Subscriber {
  inbox = [];
  kept = null;

  constructor(name, events) {
    this.name = name;
    this.events = new Set(events);
  }

  // Whether the delivery reached the inbox now (not kept back).
  update(delivery) {
    if (this.kept !== null) this.kept.push(delivery);
    else this.inbox.push(delivery);
    return this.kept === null;
  }
}

// The subject: it updates every subscriber that chose the event, in the order they
// subscribed, and knows nothing else about them.
class BuildEvents {
  #subscribers = new Map();

  subscribe(subscriber, events) {
    given(subscriber);
    if (events.length === 0 || new Set(events).size !== events.length)
      throw new RangeError("no events, or one listed twice");
    events.forEach(checkEvent);
    if (this.#subscribers.has(subscriber))
      throw new RangeError("already subscribed");
    this.#subscribers.set(subscriber, new Subscriber(subscriber, events));
  }

  unsubscribe(subscriber) {
    given(subscriber);
    return this.#subscribers.delete(subscriber);
  }

  publish(event, build) {
    checkEvent(event);
    given(build);
    const delivered = [];
    for (const subscriber of this.#subscribers.values()) {
      if (!subscriber.events.has(event)) continue;
      if (subscriber.update(`${build} ${event}`))
        delivered.push(subscriber.name);
    }
    return delivered;
  }

  inbox(subscriber) {
    return [...this.#subscriber(subscriber).inbox];
  }

  // The extension round: holding deliveries back.
  pause(subscriber) {
    const found = this.#subscriber(subscriber);
    if (found.kept !== null) throw new RangeError("already paused");
    found.kept = [];
  }

  resume(subscriber) {
    const found = this.#subscriber(subscriber);
    if (found.kept === null) throw new RangeError("not paused");
    found.inbox.push(...found.kept);
    const delivered = found.kept.length;
    found.kept = null;
    return delivered;
  }

  #subscriber(subscriber) {
    const found = this.#subscribers.get(subscriber);
    if (found === undefined) throw new RangeError("not subscribed");
    return found;
  }
}

module.exports = { BuildEvents };
