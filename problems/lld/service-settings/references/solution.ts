const MIN_WORKERS = 1;
const MAX_WORKERS = 64;
const MAX_RETRIES = 10;

function expect(holds: boolean, what: string): void {
  if (!holds) throw new RangeError(what);
}

function validWorkers(n: number): boolean {
  return n >= MIN_WORKERS && n <= MAX_WORKERS;
}

// Every precondition is checked once, at construction: a ServiceSettings that exists is
// valid, and no later call can make it invalid (its class invariant).
export class ServiceSettings {
  private readonly port: number;
  private workers: number;
  private readonly timeoutMs: number;
  private tls: [string, string] | null = null;

  constructor(port: number, workers: number, timeoutMs: number) {
    expect(port >= 1 && port <= 65535, "port is from 1 to 65535");
    expect(validWorkers(workers), "workers is from 1 to 64");
    expect(
      timeoutMs >= 1 && timeoutMs <= 60_000,
      "timeoutMs is from 1 to 60000",
    );
    this.port = port;
    this.workers = workers;
    this.timeoutMs = timeoutMs;
  }

  withWorkers(n: number): boolean {
    if (!validWorkers(n)) return false;
    this.workers = n;
    return true;
  }

  budgetMs(retries: number): number {
    expect(retries >= 0 && retries <= MAX_RETRIES, "retries is from 0 to 10");
    return this.timeoutMs * (retries + 1);
  }

  describe(): string {
    const base = `port=${String(this.port)} workers=${String(this.workers)} timeoutMs=${String(this.timeoutMs)}`;
    return this.tls === null
      ? base
      : `${base} tls=${this.tls[0]},${this.tls[1]}`;
  }

  // The extension round: TLS is both paths or neither, never half configured.
  withTls(certPath: string, keyPath: string): boolean {
    if ((certPath === "") !== (keyPath === "")) return false;
    this.tls = certPath === "" ? null : [certPath, keyPath];
    return true;
  }
}
