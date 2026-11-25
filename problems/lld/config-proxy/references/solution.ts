const MAX_TTL_MS = 1_000_000_000;

class Unavailable extends Error {}

function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

// The slow upstream: it counts every call made to it, and while it's down every call
// fails.
class ConfigService {
  readonly values = new Map<string, string>();
  down = false;
  calls = 0;

  fetch(key: string): string | null {
    this.calls += 1;
    if (this.down) throw new Unavailable(key);
    return this.values.get(key) ?? null;
  }
}

interface Entry {
  readonly value: string;
  readonly fetchedMs: number;
}

// Stands in front of the config service with the same job, reading a key, and calls
// through only when its copy is missing or older than the TTL. When the call fails, a
// stale copy is better than nothing.
export class ConfigProxy {
  private readonly ttl: number;
  private readonly upstream = new ConfigService();
  private readonly cache = new Map<string, Entry>();

  constructor(ttlMs: number) {
    if (ttlMs < 1 || ttlMs > MAX_TTL_MS)
      throw new RangeError("ttl out of range");
    this.ttl = ttlMs;
  }

  upstreamSet(key: string, val: string): void {
    given(key);
    given(val);
    this.upstream.values.set(key, val);
  }

  read(key: string, nowMs: number): string | null {
    given(key);
    const kept = this.cache.get(key);
    if (kept !== undefined && nowMs - kept.fetchedMs < this.ttl)
      return kept.value;
    let value: string | null;
    try {
      value = this.upstream.fetch(key);
    } catch (e) {
      if (!(e instanceof Unavailable)) throw e;
      return kept?.value ?? null;
    }
    if (value !== null) this.cache.set(key, { value, fetchedMs: nowMs });
    return value;
  }

  upstreamDown(down: boolean): void {
    this.upstream.down = down;
  }

  upstreamFetches(): number {
    return this.upstream.calls;
  }

  // The extension round: dropping a copy before its time.
  invalidate(key: string): void {
    given(key);
    this.cache.delete(key);
  }
}
