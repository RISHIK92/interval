"use strict";

const MAX_WEIGHT = 100;

// The backend after the one picked last, in the order they were added, wrapping.
class RoundRobin {
  #last = -1;

  choose(backends) {
    const count = backends.length;
    for (let step = 0; step < count; step++) {
      const at = (this.#last + 1 + step) % count;
      if (!backends[at].drained) {
        this.#last = at;
        return backends[at];
      }
    }
    throw new RangeError("no backend to pick");
  }
}

// The backend with the fewest open connections; a tie goes to the one added first.
class LeastConnections {
  choose(backends) {
    let best = null;
    for (const backend of backends)
      if (!backend.drained && (best === null || backend.open < best.open))
        best = backend;
    if (best === null) throw new RangeError("no backend to pick");
    return best;
  }
}

// Smooth weighted round robin: every pick, each backend's current weight grows by its
// weight, the largest is picked (a tie goes to the one added first), and the pick gives
// back the total, so heavy backends are spread out instead of picked in a row.
class SmoothWeighted {
  #current = new Map();

  choose(backends) {
    let best = null;
    let total = 0;
    for (const backend of backends) {
      if (backend.drained) continue;
      total += backend.weight;
      this.#current.set(
        backend.name,
        (this.#current.get(backend.name) ?? 0) + backend.weight,
      );
      if (
        best === null ||
        this.#current.get(backend.name) > this.#current.get(best.name)
      )
        best = backend;
    }
    if (best === null) throw new RangeError("no backend to pick");
    this.#current.set(best.name, this.#current.get(best.name) - total);
    return best;
  }
}

const STRATEGIES = new Map([
  ["round-robin", () => new RoundRobin()],
  ["least-connections", () => new LeastConnections()],
  ["weighted-round-robin", () => new SmoothWeighted()],
]);

function fresh(strategy) {
  const make = STRATEGIES.get(strategy);
  if (make === undefined) throw new RangeError("unknown strategy");
  return make();
}

// Picks a backend for each new connection with a strategy that can be swapped at
// runtime. The balancer owns the backends and their connection counts; a strategy owns
// only its own position, so a new one starts fresh and loses no connections.
class Balancer {
  #backends = [];
  #byName = new Map();
  #strategy;

  constructor(strategy) {
    this.#strategy = fresh(strategy);
  }

  addBackend(name, weight) {
    if (
      name === "" ||
      this.#byName.has(name) ||
      weight < 1 ||
      weight > MAX_WEIGHT
    )
      throw new RangeError("bad backend");
    const backend = { name, weight, open: 0, drained: false };
    this.#backends.push(backend);
    this.#byName.set(name, backend);
  }

  pick() {
    const backend = this.#strategy.choose(this.#backends);
    backend.open += 1;
    return backend.name;
  }

  done(backend) {
    const found = this.#backend(backend);
    if (found.open === 0) throw new RangeError("no open connection");
    found.open -= 1;
  }

  useStrategy(strategy) {
    this.#strategy = fresh(strategy);
  }

  // The extension round: taking a backend out of rotation.
  drain(backend) {
    const found = this.#backend(backend);
    if (found.drained) throw new RangeError("already drained");
    found.drained = true;
  }

  #backend(name) {
    const found = this.#byName.get(name);
    if (found === undefined) throw new RangeError("unknown backend");
    return found;
  }
}

module.exports = { Balancer };
