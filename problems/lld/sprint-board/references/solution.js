"use strict";

// The columns, in board order: a ticket moves only to a neighbour.
const COLUMNS = ["todo", "doing", "review", "done"];
const DOING = COLUMNS.indexOf("doing");
const DONE = COLUMNS.indexOf("done");

class SprintBoard {
  #limit;
  // Insertion order is ticket-number order.
  #tickets = new Map();

  constructor(wipLimit) {
    if (wipLimit < 1 || wipLimit > 100)
      throw new RangeError("wipLimit must be within 1-100");
    this.#limit = wipLimit;
  }

  #ticket(ticket) {
    const t = this.#tickets.get(ticket);
    if (t === undefined) throw new RangeError("no such ticket");
    return t;
  }

  #in(column) {
    return [...this.#tickets.values()].filter((t) => t.column === column);
  }

  add(title, points) {
    if (title === "" || points < 1 || points > 100)
      throw new RangeError("a ticket needs a title and 1-100 points");
    const ticket = `T-${this.#tickets.size + 1}`;
    this.#tickets.set(ticket, { points, column: 0, reason: null });
    return ticket;
  }

  move(ticket, column) {
    const t = this.#ticket(ticket);
    const to = COLUMNS.indexOf(column);
    if (to < 0) throw new RangeError("no such column");
    if (Math.abs(to - t.column) !== 1 || t.reason !== null) return false;
    if (to === DOING && this.#in(DOING).length >= this.#limit) return false;
    t.column = to;
    return true;
  }

  column(ticket) {
    return COLUMNS[this.#ticket(ticket).column];
  }

  velocity() {
    return this.#in(DONE).reduce((sum, t) => sum + t.points, 0);
  }

  // The extension round.
  block(ticket, reason) {
    const t = this.#ticket(ticket);
    if (reason === "") throw new RangeError("a block needs a reason");
    t.reason = reason;
  }

  unblock(ticket) {
    this.#ticket(ticket).reason = null;
  }

  blocked() {
    return [...this.#tickets]
      .filter(([, t]) => t.reason !== null)
      .map(([k, t]) => `${k}: ${t.reason}`);
  }
}

module.exports = { SprintBoard };
