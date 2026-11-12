export class RateLimiter {
  private readonly limit: number;
  private readonly window: number;
  // Each client's allowed requests, oldest first, and the time of its last call.
  private readonly log = new Map<string, number[]>();
  private readonly last = new Map<string, number>();

  constructor(limit: number, windowMs: number) {
    if (limit < 1 || windowMs < 1)
      throw new RangeError("limit and window must be at least 1");
    this.limit = limit;
    this.window = windowMs;
  }

  private current(client: string, now: number): number[] {
    const last = this.last.get(client);
    if (last !== undefined && now < last)
      throw new RangeError("time went backwards");
    this.last.set(client, now);
    const log = this.log.get(client) ?? [];
    this.log.set(client, log);
    while (log[0] !== undefined && log[0] <= now - this.window) log.shift();
    return log;
  }

  allow(client: string, nowMs: number): boolean {
    const log = this.current(client, nowMs);
    if (log.length >= this.limit) return false;
    log.push(nowMs);
    return true;
  }

  remaining(client: string, nowMs: number): number {
    return this.limit - this.current(client, nowMs).length;
  }
}
