const MAX_THRESHOLD = 1000;
const MAX_COOL_DOWN_MS = 1e9;

interface Settings {
  readonly threshold: number;
  readonly coolDownMs: number;
}

// One state's rules. Each event returns the state the breaker is in afterwards, so the
// breaker itself never asks which state it's in.
abstract class State {
  abstract readonly name: string;

  tick(_settings: Settings, _nowMs: number): State {
    return this;
  }

  allow(): boolean {
    return false;
  }

  success(_settings: Settings, _nowMs: number): State {
    return this;
  }

  failure(_settings: Settings, _nowMs: number): State {
    return this;
  }

  force(on: boolean): State {
    return on ? new ForcedOpen() : this;
  }
}

class Closed extends State {
  readonly name = "closed";
  private failures = 0;

  override allow(): boolean {
    return true;
  }

  override success(): State {
    this.failures = 0;
    return this;
  }

  override failure(settings: Settings, nowMs: number): State {
    this.failures += 1;
    return this.failures >= settings.threshold ? new Open(nowMs) : this;
  }
}

// Refuses every call until the cool-down has passed; outcomes of calls let through
// earlier change nothing.
class Open extends State {
  readonly name = "open";
  private readonly openedMs: number;

  constructor(openedMs: number) {
    super();
    this.openedMs = openedMs;
  }

  override tick(settings: Settings, nowMs: number): State {
    return nowMs >= this.openedMs + settings.coolDownMs ? new HalfOpen() : this;
  }
}

// Lets one trial call through; only that call's outcome decides what comes next.
class HalfOpen extends State {
  readonly name = "half-open";
  private trial = false;

  override allow(): boolean {
    const allowed = !this.trial;
    this.trial = true;
    return allowed;
  }

  override success(): State {
    return this.trial ? new Closed() : this;
  }

  override failure(_settings: Settings, nowMs: number): State {
    return this.trial ? new Open(nowMs) : this;
  }
}

// The manual override: open, with no cool-down, until it's released.
class ForcedOpen extends State {
  readonly name = "open";

  override force(on: boolean): State {
    return on ? this : new Closed();
  }
}

// Guards calls to a failing dependency. The breaker checks the time and hands every
// event to its current state object, which says what happens and what comes next.
export class CircuitBreaker {
  private readonly settings: Settings;
  private current: State = new Closed();
  private lastMs = 0;

  constructor(threshold: number, coolDownMs: number) {
    if (
      threshold < 1 ||
      threshold > MAX_THRESHOLD ||
      coolDownMs < 1 ||
      coolDownMs > MAX_COOL_DOWN_MS
    )
      throw new RangeError("bad threshold or cool-down");
    this.settings = { threshold, coolDownMs };
  }

  allow(nowMs: number): boolean {
    return this.at(nowMs).allow();
  }

  success(nowMs: number): void {
    this.current = this.at(nowMs).success(this.settings, nowMs);
  }

  failure(nowMs: number): void {
    this.current = this.at(nowMs).failure(this.settings, nowMs);
  }

  state(nowMs: number): string {
    return this.at(nowMs).name;
  }

  // The extension round: the manual override.
  forceOpen(on: boolean): void {
    this.current = this.current.force(on);
  }

  private at(nowMs: number): State {
    if (nowMs < this.lastMs) throw new RangeError("time went backwards");
    this.lastMs = nowMs;
    this.current = this.current.tick(this.settings, nowMs);
    return this.current;
  }
}
