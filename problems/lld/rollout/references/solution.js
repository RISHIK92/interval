"use strict";

const ADVANCE_BELOW = 1;
const ABORT_ABOVE = 5;
const MAX_RATE = 100;

// One state of the rollout. Each move returns the next state, or null when this state
// doesn't allow it, so every state lists only its own moves.
class State {
  constructor(name, percent) {
    this.name = name;
    this.percent = percent;
  }

  begin() {
    return null;
  }

  advance() {
    return null;
  }

  pause() {
    return null;
  }

  resume() {
    return null;
  }

  abort() {
    return null;
  }
}

class Paused extends State {
  #was;

  constructor(was) {
    super("paused", was.percent);
    this.#was = was;
  }

  resume() {
    return this.#was;
  }
}

// Canary and rolling share their moves: on, pause and abort.
class Moving extends State {
  #after;

  constructor(name, percent, after) {
    super(name, percent);
    this.#after = after;
  }

  advance() {
    return this.#after;
  }

  pause() {
    return new Paused(this);
  }

  abort() {
    return new State("rolled-back", 0);
  }
}

class Pending extends State {
  constructor() {
    super("pending", 0);
  }

  begin() {
    return new Moving(
      "canary",
      10,
      new Moving("rolling", 50, new State("done", 100)),
    );
  }
}

class Rollout {
  #service;
  #version = "";
  #state = new Pending();

  constructor(service) {
    if (service === "") throw new RangeError("an empty service");
    this.#service = service;
  }

  #move(to) {
    if (to === null) return false;
    this.#state = to;
    return true;
  }

  begin(version) {
    if (version === "") throw new RangeError("an empty version");
    const to = this.#state.begin();
    if (to !== null) this.#version = version;
    return this.#move(to);
  }

  advance() {
    return this.#move(this.#state.advance());
  }

  pause() {
    return this.#move(this.#state.pause());
  }

  resume() {
    return this.#move(this.#state.resume());
  }

  abort() {
    return this.#move(this.#state.abort());
  }

  status() {
    if (this.#version === "") return `${this.#service} ${this.#state.name}`;
    return `${this.#service} ${this.#state.name} ${this.#version} ${this.#state.percent}%`;
  }

  // The extension round: the error rate decides the move.
  autoAdvance(errorRate) {
    if (errorRate < 0 || errorRate > MAX_RATE)
      throw new RangeError("an error rate from 0 to 100");
    if (errorRate < ADVANCE_BELOW) return this.advance();
    if (errorRate > ABORT_ABOVE) return this.abort();
    return false;
  }
}

module.exports = { Rollout };
