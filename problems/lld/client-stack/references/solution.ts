const FAILURE = 500; // a status of at least this is a failure
const BACKOFF_MS = 100; // the wait before the first retry; it doubles for each one after
const OPEN_MS = 1000; // how long a breaker stays open

interface Answer {
  status: number;
  took: number;
}

// Every layer, and the transport at the bottom, has the same call: a request for a path
// that starts at time t returns its status and how long it took. A layer wraps the one
// below it and never knows what that is.
interface Layer {
  call(path: string, t: number): Answer;
}

// One path's scripted answers: in order, then the last one again and again.
class Script {
  private readonly answers: readonly Answer[];
  private served = 0;

  constructor(statuses: readonly number[], latencies: readonly number[]) {
    this.answers = statuses.map((status, i) => ({
      status,
      took: latencies[i] ?? 0,
    }));
  }

  next(): Answer {
    const answer = this.answers[
      Math.min(this.served, this.answers.length - 1)
    ] ?? { status: 0, took: 0 };
    this.served += 1;
    return answer;
  }
}

class Transport implements Layer {
  readonly scripts = new Map<string, Script>();
  calls = 0;

  call(path: string): Answer {
    const script = this.scripts.get(path);
    if (script === undefined) throw new RangeError("an unscripted path");
    this.calls += 1;
    return script.next();
  }
}

class Retry implements Layer {
  private readonly inner: Layer;
  private readonly retries: number;

  constructor(inner: Layer, retries: number) {
    this.inner = inner;
    this.retries = retries;
  }

  call(path: string, t: number): Answer {
    let spent = 0;
    let answer: Answer = { status: 0, took: 0 };
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) spent += BACKOFF_MS * 2 ** (attempt - 1);
      answer = this.inner.call(path, t + spent);
      spent += answer.took;
      if (answer.status < FAILURE) break;
    }
    return { status: answer.status, took: spent };
  }
}

class Cache implements Layer {
  private readonly inner: Layer;
  private readonly ttl: number;
  private readonly stored = new Map<string, number>(); // path -> when its 200 arrived

  constructor(inner: Layer, ttl: number) {
    this.inner = inner;
    this.ttl = ttl;
  }

  call(path: string, t: number): Answer {
    const at = this.stored.get(path);
    if (at !== undefined && at <= t && t < at + this.ttl)
      return { status: 200, took: 0 };
    const answer = this.inner.call(path, t);
    if (answer.status === 200) this.stored.set(path, t + answer.took);
    return answer;
  }
}

class Breaker implements Layer {
  private readonly inner: Layer;
  private readonly threshold: number;
  private failures = 0;
  private opened: number | null = null;

  constructor(inner: Layer, threshold: number) {
    this.inner = inner;
    this.threshold = threshold;
  }

  call(path: string, t: number): Answer {
    if (this.opened !== null && this.opened <= t && t < this.opened + OPEN_MS)
      return { status: 503, took: 0 };
    const answer = this.inner.call(path, t);
    if (answer.status < FAILURE) {
      this.failures = 0;
      return answer;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.opened = t + answer.took;
      // It stays at the threshold, so after the cooldown one more failure
      // reopens it straight away; a success only resets the count, and an
      // open window runs out on its own.
      this.failures = this.threshold;
    }
    return answer;
  }
}

class Hedge implements Layer {
  private readonly inner: Layer;
  private readonly after: number;

  constructor(inner: Layer, after: number) {
    this.inner = inner;
    this.after = after;
  }

  call(path: string, t: number): Answer {
    const first = this.inner.call(path, t);
    if (first.took <= this.after) return first;
    const second = this.inner.call(path, t + this.after);
    if (this.after + second.took < first.took)
      return { status: second.status, took: this.after + second.took };
    return first;
  }
}

const LAYERS: Record<string, (inner: Layer, param: number) => Layer> = {
  retry: (inner, n) => new Retry(inner, n),
  cache: (inner, n) => new Cache(inner, n),
  breaker: (inner, n) => new Breaker(inner, n),
};

// A decorator stack over a scripted transport: each wrap puts a layer outside the ones
// already there, so the order of the wraps decides what each layer sees.
export class ClientStack {
  private readonly transport = new Transport();
  private top: Layer = this.transport;
  private elapsed = 0;

  script(path: string, statuses: number[], latenciesMs: number[]): void {
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
    this.transport.scripts.set(path, new Script(statuses, latenciesMs));
  }

  wrap(layer: string, param: number): void {
    const make = Object.hasOwn(LAYERS, layer) ? LAYERS[layer] : undefined;
    if (make === undefined) throw new RangeError("unknown layer");
    if (param < 1 || (layer === "retry" && param > 5))
      throw new RangeError("a parameter out of range");
    this.top = make(this.top, param);
  }

  fetch(path: string, nowMs: number): number {
    if (!this.transport.scripts.has(path))
      throw new RangeError("an unscripted path");
    const answer = this.top.call(path, nowMs);
    this.elapsed = answer.took;
    return answer.status;
  }

  upstreamCalls(): number {
    return this.transport.calls;
  }

  elapsedMs(): number {
    return this.elapsed;
  }

  // The extension round: one more layer, which only needs the same call as the rest.
  hedge(afterMs: number): void {
    if (afterMs < 0) throw new RangeError("a negative delay");
    this.top = new Hedge(this.top, afterMs);
  }
}
