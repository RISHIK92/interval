const MAX_WEIGHT = 100;

interface Backend {
  readonly name: string;
  readonly weight: number;
  open: number;
  drained: boolean;
}

interface Strategy {
  choose(backends: readonly Backend[]): Backend;
}

// The backend after the one picked last, in the order they were added, wrapping.
class RoundRobin implements Strategy {
  private last = -1;

  choose(backends: readonly Backend[]): Backend {
    const count = backends.length;
    for (let step = 0; step < count; step++) {
      const at = (this.last + 1 + step) % count;
      const backend = backends[at];
      if (backend !== undefined && !backend.drained) {
        this.last = at;
        return backend;
      }
    }
    throw new RangeError("no backend to pick");
  }
}

// The backend with the fewest open connections; a tie goes to the one added first.
class LeastConnections implements Strategy {
  choose(backends: readonly Backend[]): Backend {
    let best: Backend | null = null;
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
class SmoothWeighted implements Strategy {
  private readonly current = new Map<string, number>();

  choose(backends: readonly Backend[]): Backend {
    let best: Backend | null = null;
    let bestCurrent = 0;
    let total = 0;
    for (const backend of backends) {
      if (backend.drained) continue;
      total += backend.weight;
      const current = (this.current.get(backend.name) ?? 0) + backend.weight;
      this.current.set(backend.name, current);
      if (best === null || current > bestCurrent) {
        best = backend;
        bestCurrent = current;
      }
    }
    if (best === null) throw new RangeError("no backend to pick");
    this.current.set(best.name, bestCurrent - total);
    return best;
  }
}

const STRATEGIES = new Map<string, () => Strategy>([
  ["round-robin", () => new RoundRobin()],
  ["least-connections", () => new LeastConnections()],
  ["weighted-round-robin", () => new SmoothWeighted()],
]);

function fresh(strategy: string): Strategy {
  const make = STRATEGIES.get(strategy);
  if (make === undefined) throw new RangeError("unknown strategy");
  return make();
}

// Picks a backend for each new connection with a strategy that can be swapped at
// runtime. The balancer owns the backends and their connection counts; a strategy owns
// only its own position, so a new one starts fresh and loses no connections.
export class Balancer {
  private readonly backends: Backend[] = [];
  private readonly byName = new Map<string, Backend>();
  private strategy: Strategy;

  constructor(strategy: string) {
    this.strategy = fresh(strategy);
  }

  addBackend(name: string, weight: number): void {
    if (
      name === "" ||
      this.byName.has(name) ||
      weight < 1 ||
      weight > MAX_WEIGHT
    )
      throw new RangeError("bad backend");
    const backend: Backend = { name, weight, open: 0, drained: false };
    this.backends.push(backend);
    this.byName.set(name, backend);
  }

  pick(): string {
    const backend = this.strategy.choose(this.backends);
    backend.open += 1;
    return backend.name;
  }

  done(backend: string): void {
    const found = this.backend(backend);
    if (found.open === 0) throw new RangeError("no open connection");
    found.open -= 1;
  }

  useStrategy(strategy: string): void {
    this.strategy = fresh(strategy);
  }

  // The extension round: taking a backend out of rotation.
  drain(backend: string): void {
    const found = this.backend(backend);
    if (found.drained) throw new RangeError("already drained");
    found.drained = true;
  }

  private backend(name: string): Backend {
    const found = this.byName.get(name);
    if (found === undefined) throw new RangeError("unknown backend");
    return found;
  }
}
