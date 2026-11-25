"use strict";

const MAX_PRIORITY = 1_000_000;
const MAX_MS = 1_000_000_000_000;

// Compares two keys of equal length, element by element.
function before(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

// The contract every kind honours lives here, once: only ready jobs leave, size counts
// every job, a job leaves once, and peeking asks the same question polling does. A kind
// only says (in order(job)) which ready job comes first, so it can't break any of that.
class Queue {
  constructor() {
    this.jobs = new Map();
  }

  push(job) {
    this.jobs.set(job.name, job);
  }

  peek(now) {
    let first = null;
    for (const job of this.jobs.values())
      if (
        job.notBefore <= now &&
        (first === null || before(this.order(job), this.order(first)))
      )
        first = job;
    return first;
  }

  poll(now) {
    const job = this.peek(now);
    if (job !== null) this.jobs.delete(job.name);
    return job;
  }

  remove(name) {
    return this.jobs.delete(name);
  }

  size() {
    return this.jobs.size;
  }
}

class FifoQueue extends Queue {
  order(job) {
    return [job.seq];
  }
}

class PriorityQueue extends Queue {
  order(job) {
    return [-job.priority, job.seq];
  }
}

class DelayedQueue extends Queue {
  order(job) {
    return [job.notBefore, job.seq];
  }
}

const KINDS = new Map([
  ["fifo", FifoQueue],
  ["priority", PriorityQueue],
  ["delayed", DelayedQueue],
]);

function time(ms) {
  if (ms < 0 || ms > MAX_MS) throw new RangeError("a time is 0 to 10^12");
  return ms;
}

class JobQueue {
  constructor(kind) {
    const make = KINDS.get(kind);
    if (make === undefined) throw new Error("an unknown kind");
    this.queue = new make();
    this.used = new Set();
  }

  push(job, priority, notBeforeMs) {
    if (job === "" || this.used.has(job))
      throw new Error("a job needs a name of its own");
    if (priority < 0 || priority > MAX_PRIORITY)
      throw new RangeError("a priority is 0 to 10^6");
    const notBefore = time(notBeforeMs);
    this.queue.push({ name: job, priority, notBefore, seq: this.used.size });
    this.used.add(job);
  }

  poll(nowMs) {
    return this.queue.poll(time(nowMs))?.name ?? null;
  }

  peekAt(nowMs) {
    return this.queue.peek(time(nowMs))?.name ?? null;
  }

  size() {
    return this.queue.size();
  }

  // The extension round.
  cancel(job) {
    if (job === "") throw new Error("an empty job");
    return this.queue.remove(job);
  }
}

module.exports = { JobQueue };
