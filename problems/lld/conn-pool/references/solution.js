"use strict";

const MAX_SIZE = 1000;

class ConnPool {
  #max;
  // Every connection ever made, including the discarded ones.
  #made = new Set();
  // Most recently released last: reusing from the end keeps the warmest connection busy
  // and lets the coldest ones age out.
  #idle = [];
  #held = new Map();

  constructor(maxSize) {
    if (maxSize < 1 || maxSize > MAX_SIZE)
      throw new RangeError("maxSize is 1 to 1000");
    this.#max = maxSize;
  }

  #known(conn) {
    if (!this.#made.has(conn))
      throw new RangeError("not a connection this pool made");
  }

  acquire(client) {
    if (client === "") throw new RangeError("clients are named");
    let conn = this.#idle.pop();
    if (conn === undefined) {
      if (this.#held.size >= this.#max) return null;
      conn = `conn-${this.#made.size + 1}`;
      this.#made.add(conn);
    }
    this.#held.set(conn, client);
    return conn;
  }

  release(conn) {
    this.#known(conn);
    if (!this.#held.delete(conn)) return false;
    this.#idle.push(conn);
    return true;
  }

  invalidate(conn) {
    this.#known(conn);
    const at = this.#idle.indexOf(conn);
    if (at >= 0) {
      this.#idle.splice(at, 1);
      return true;
    }
    return this.#held.delete(conn);
  }

  created() {
    return this.#made.size;
  }

  idle() {
    return this.#idle.length;
  }

  // The extension round: close the coldest idle connections past a limit.
  shrink(maxIdle) {
    if (maxIdle < 0) throw new RangeError("maxIdle is not negative");
    const closing = Math.max(this.#idle.length - maxIdle, 0);
    this.#idle = this.#idle.slice(closing);
    return closing;
  }
}

module.exports = { ConnPool };
