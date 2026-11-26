"use strict";

const MAX_THRESHOLD = 1000;
const MAX_COOL_DOWN_MS = 1e9;

// One state's rules. Each event returns the state the breaker is in afterwards, so the
// breaker itself never asks which state it's in.
class State {
  tick() {
    return this;
  }

  allow() {
    return false;
  }

  success() {
    return this;
  }

  failure() {
    return this;
  }

  force(on) {
    return on ? new ForcedOpen() : this;
  }
}

class Closed extends State {
  name = "closed";
  #failures = 0;

  allow() {
    return true;
  }

  success() {
    this.#failures = 0;
    return this;
  }

  failure(breaker, nowMs) {
    this.#failures += 1;
    return this.#failures >= breaker.threshold ? new Open(nowMs) : this;
  }
}

// Refuses every call until the cool-down has passed; outcomes of calls let through
// earlier change nothing.
class Open extends State {
  name = "open";
  #openedMs;

  constructor(openedMs) {
    super();
    this.#openedMs = openedMs;
  }

  tick(breaker, nowMs) {
    return nowMs >= this.#openedMs + breaker.coolDownMs ? new HalfOpen() : this;
  }
}

// Lets one trial call through; only that call's outcome decides what comes next.
class HalfOpen extends State {
  name = "half-open";
  #trial = false;

  allow() {
    const allowed = !this.#trial;
    this.#trial = true;
    return allowed;
  }

  success() {
    return this.#trial ? new Closed() : this;
  }

  failure(breaker, nowMs) {
    return this.#trial ? new Open(nowMs) : this;
  }
}

// The manual override: open, with no cool-down, until it's released.
class ForcedOpen extends State {
  name = "open";

  force(on) {
    return on ? this : new Closed();
  }
}

// Guards calls to a failing dependency. The breaker checks the time and hands every
// event to its current state object, which says what happens and what comes next.
class CircuitBreaker {
  #state = new Closed();
  #lastMs = 0;

  constructor(threshold, coolDownMs) {
    if (
      threshold < 1 ||
      threshold > MAX_THRESHOLD ||
      coolDownMs < 1 ||
      coolDownMs > MAX_COOL_DOWN_MS
    )
      throw new RangeError("bad threshold or cool-down");
    this.threshold = threshold;
    this.coolDownMs = coolDownMs;
  }

  allow(nowMs) {
    return this.#at(nowMs).allow();
  }

  success(nowMs) {
    this.#state = this.#at(nowMs).success(this, nowMs);
  }

  failure(nowMs) {
    this.#state = this.#at(nowMs).failure(this, nowMs);
  }

  state(nowMs) {
    return this.#at(nowMs).name;
  }

  // The extension round: the manual override.
  forceOpen(on) {
    this.#state = this.#state.force(on);
  }

  #at(nowMs) {
    if (nowMs < this.#lastMs) throw new RangeError("time went backwards");
    this.#lastMs = nowMs;
    this.#state = this.#state.tick(this, nowMs);
    return this.#state;
  }
}

module.exports = { CircuitBreaker };
