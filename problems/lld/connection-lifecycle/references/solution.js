"use strict";

const State = Object.freeze({
  IDLE: "idle",
  OPEN: "open",
  CLOSED: "closed",
  FAILED: "failed",
});

// Every legal move: action -> (from -> to). Anything else is refused.
const MOVES = {
  connect: { [State.IDLE]: State.OPEN },
  disconnect: { [State.OPEN]: State.CLOSED },
  fail: { [State.IDLE]: State.FAILED, [State.OPEN]: State.FAILED },
  reconnect: { [State.FAILED]: State.OPEN },
};

class Connection {
  #host;
  #state = State.IDLE;
  #reopened = 0;

  constructor(host) {
    if (host === "") throw new RangeError("a connection needs a host");
    this.#host = host;
  }

  #move(action) {
    const to = MOVES[action][this.#state];
    if (to === undefined) return false;
    this.#state = to;
    return true;
  }

  connect() {
    return this.#move("connect");
  }

  disconnect() {
    return this.#move("disconnect");
  }

  fail(reason) {
    if (reason === "") throw new RangeError("a failure needs a reason");
    this.#move("fail");
  }

  state() {
    return this.#state;
  }

  // The extension round.
  reconnect() {
    const moved = this.#move("reconnect");
    if (moved) this.#reopened += 1;
    return moved;
  }

  attempts() {
    return this.#reopened;
  }
}

module.exports = { Connection };
