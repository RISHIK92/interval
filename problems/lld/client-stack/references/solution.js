"use strict";

const FAILURE = 500; // a status of at least this is a failure
const BACKOFF_MS = 100; // the wait before the first retry; it doubles for each one after
const OPEN_MS = 1000; // how long a breaker stays open

// One path's scripted answers: in order, then the last one again and again.
class Script {
  #answers;
  #served = 0;

  constructor(statuses, latencies) {
    this.#answers = statuses.map((status, i) => ({
      status,
      took: latencies[i],
    }));
  }

  next() {
    const answer =
      this.#answers[Math.min(this.#served, this.#answers.length - 1)];
    this.#served += 1;
    return answer;
  }
}

// Every layer, and the transport at the bottom, has the same call(path, t): a request
// for a path that starts at time t returns its status and how long it took. A layer
// wraps the one below it and never knows what that is.
class Transport {
  scripts = new Map();
  calls = 0;

  call(path) {
    this.calls += 1;
    return this.scripts.get(path).next();
  }
}

class Retry {
  #inner;
  #retries;

  constructor(inner, retries) {
    this.#inner = inner;
    this.#retries = retries;
  }

  call(path, t) {
    let spent = 0;
    let answer;
    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      if (attempt > 0) spent += BACKOFF_MS * 2 ** (attempt - 1);
      answer = this.#inner.call(path, t + spent);
      spent += answer.took;
      if (answer.status < FAILURE) break;
    }
    return { status: answer.status, took: spent };
  }
}

class Cache {
  #inner;
  #ttl;
  #stored = new Map(); // path -> when its 200 arrived

  constructor(inner, ttl) {
    this.#inner = inner;
    this.#ttl = ttl;
  }

  call(path, t) {
    const at = this.#stored.get(path);
    if (at !== undefined && at <= t && t < at + this.#ttl)
      return { status: 200, took: 0 };
    const answer = this.#inner.call(path, t);
    if (answer.status === 200) this.#stored.set(path, t + answer.took);
    return answer;
  }
}

class Breaker {
  #inner;
  #threshold;
  #failures = 0;
  #opened = null;

  constructor(inner, threshold) {
    this.#inner = inner;
    this.#threshold = threshold;
  }

  call(path, t) {
    if (
      this.#opened !== null &&
      this.#opened <= t &&
      t < this.#opened + OPEN_MS
    )
      return { status: 503, took: 0 };
    const answer = this.#inner.call(path, t);
    if (answer.status < FAILURE) {
      this.#failures = 0;
      return answer;
    }
    this.#failures += 1;
    if (this.#failures >= this.#threshold) {
      this.#opened = t + answer.took;
      // It stays at the threshold, so after the cooldown one more failure
      // reopens it straight away; a success only resets the count, and an
      // open window runs out on its own.
      this.#failures = this.#threshold;
    }
    return answer;
  }
}

class Hedge {
  #inner;
  #after;

  constructor(inner, after) {
    this.#inner = inner;
    this.#after = after;
  }

  call(path, t) {
    const first = this.#inner.call(path, t);
    if (first.took <= this.#after) return first;
    const second = this.#inner.call(path, t + this.#after);
    if (this.#after + second.took < first.took)
      return { status: second.status, took: this.#after + second.took };
    return first;
  }
}

const LAYERS = new Map([
  ["retry", (inner, n) => new Retry(inner, n)],
  ["cache", (inner, n) => new Cache(inner, n)],
  ["breaker", (inner, n) => new Breaker(inner, n)],
]);

// A decorator stack over a scripted transport: each wrap puts a layer outside the ones
// already there, so the order of the wraps decides what each layer sees.
class ClientStack {
  #transport = new Transport();
  #top = this.#transport;
  #elapsed = 0;

  script(path, statuses, latenciesMs) {
    if (
      path === "" ||
      statuses.length === 0 ||
      statuses.length !== latenciesMs.length
    )
      throw new RangeError("a path and one latency per status");
    if (statuses.some((s) => s < 100 || s > 599))
      throw new RangeError("not an HTTP status");
    if (latenciesMs.some((l) => l < 0))
      throw new RangeError("a negative latency");
    this.#transport.scripts.set(path, new Script(statuses, latenciesMs));
  }

  wrap(layer, param) {
    const make = LAYERS.get(layer);
    if (make === undefined) throw new RangeError("unknown layer");
    if (param < 1 || (layer === "retry" && param > 5))
      throw new RangeError("a parameter out of range");
    this.#top = make(this.#top, param);
  }

  fetch(path, nowMs) {
    if (!this.#transport.scripts.has(path))
      throw new RangeError("an unscripted path");
    const answer = this.#top.call(path, nowMs);
    this.#elapsed = answer.took;
    return answer.status;
  }

  upstreamCalls() {
    return this.#transport.calls;
  }

  elapsedMs() {
    return this.#elapsed;
  }

  // The extension round: one more layer, which only needs the same call as the rest.
  hedge(afterMs) {
    if (afterMs < 0) throw new RangeError("a negative delay");
    this.#top = new Hedge(this.#top, afterMs);
  }
}

module.exports = { ClientStack };
