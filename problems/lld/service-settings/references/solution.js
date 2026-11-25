"use strict";

const MIN_WORKERS = 1;
const MAX_WORKERS = 64;
const MAX_RETRIES = 10;

function expect(holds, what) {
  if (!holds) throw new RangeError(what);
}

function validWorkers(n) {
  return n >= MIN_WORKERS && n <= MAX_WORKERS;
}

// Every precondition is checked once, at construction: a ServiceSettings that exists is
// valid, and no later call can make it invalid (its class invariant).
class ServiceSettings {
  #port;
  #workers;
  #timeoutMs;
  #tls = null;

  constructor(port, workers, timeoutMs) {
    expect(port >= 1 && port <= 65535, "port is from 1 to 65535");
    expect(validWorkers(workers), "workers is from 1 to 64");
    expect(
      timeoutMs >= 1 && timeoutMs <= 60_000,
      "timeoutMs is from 1 to 60000",
    );
    this.#port = port;
    this.#workers = workers;
    this.#timeoutMs = timeoutMs;
  }

  withWorkers(n) {
    if (!validWorkers(n)) return false;
    this.#workers = n;
    return true;
  }

  budgetMs(retries) {
    expect(retries >= 0 && retries <= MAX_RETRIES, "retries is from 0 to 10");
    return this.#timeoutMs * (retries + 1);
  }

  describe() {
    const base = `port=${this.#port} workers=${this.#workers} timeoutMs=${this.#timeoutMs}`;
    return this.#tls === null
      ? base
      : `${base} tls=${this.#tls[0]},${this.#tls[1]}`;
  }

  // The extension round: TLS is both paths or neither, never half configured.
  withTls(certPath, keyPath) {
    if ((certPath === "") !== (keyPath === "")) return false;
    this.#tls = certPath === "" ? null : [certPath, keyPath];
    return true;
  }
}

module.exports = { ServiceSettings };
