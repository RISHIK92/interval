"use strict";

class RateLimiter {
  constructor(limit, windowMs) {
    if (limit < 1 || windowMs < 1)
      throw new RangeError("limit and window must be at least 1");
    this.limit = limit;
    this.window = windowMs;
    // Each client's allowed requests, oldest first, and the time of its last call.
    this.log = new Map();
    this.last = new Map();
  }

  current(client, now) {
    const last = this.last.get(client);
    if (last !== undefined && now < last)
      throw new RangeError("time went backwards");
    this.last.set(client, now);
    let log = this.log.get(client);
    if (log === undefined) this.log.set(client, (log = []));
    while (log.length > 0 && log[0] <= now - this.window) log.shift();
    return log;
  }

  allow(client, nowMs) {
    const log = this.current(client, nowMs);
    if (log.length >= this.limit) return false;
    log.push(nowMs);
    return true;
  }

  remaining(client, nowMs) {
    return this.limit - this.current(client, nowMs).length;
  }
}

module.exports = { RateLimiter };
