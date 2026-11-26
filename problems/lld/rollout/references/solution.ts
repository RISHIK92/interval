const ADVANCE_BELOW = 1;
const ABORT_ABOVE = 5;
const MAX_RATE = 100;

// One state of the rollout. Each move returns the next state, or null when this state
// doesn't allow it, so every state lists only its own moves.
abstract class State {
  abstract readonly name: string;
  abstract readonly percent: number;

  begin(): State | null {
    return null;
  }

  advance(): State | null {
    return null;
  }

  pause(): State | null {
    return null;
  }

  resume(): State | null {
    return null;
  }

  abort(): State | null {
    return null;
  }
}

class Done extends State {
  readonly name = "done";
  readonly percent = 100;
}

class RolledBack extends State {
  readonly name = "rolled-back";
  readonly percent = 0;
}

class Paused extends State {
  readonly name = "paused";
  readonly percent: number;
  private readonly was: State;

  constructor(was: State) {
    super();
    this.was = was;
    this.percent = was.percent;
  }

  override resume(): State | null {
    return this.was;
  }
}

// Canary and rolling share their moves: on, pause and abort.
class Moving extends State {
  readonly name: string;
  readonly percent: number;
  private readonly after: State;

  constructor(name: string, percent: number, after: State) {
    super();
    this.name = name;
    this.percent = percent;
    this.after = after;
  }

  override advance(): State | null {
    return this.after;
  }

  override pause(): State | null {
    return new Paused(this);
  }

  override abort(): State | null {
    return new RolledBack();
  }
}

class Pending extends State {
  readonly name = "pending";
  readonly percent = 0;

  override begin(): State | null {
    return new Moving("canary", 10, new Moving("rolling", 50, new Done()));
  }
}

export class Rollout {
  private readonly service: string;
  private version = "";
  private state: State = new Pending();

  constructor(service: string) {
    if (service === "") throw new RangeError("an empty service");
    this.service = service;
  }

  private move(to: State | null): boolean {
    if (to === null) return false;
    this.state = to;
    return true;
  }

  begin(version: string): boolean {
    if (version === "") throw new RangeError("an empty version");
    const to = this.state.begin();
    if (to !== null) this.version = version;
    return this.move(to);
  }

  advance(): boolean {
    return this.move(this.state.advance());
  }

  pause(): boolean {
    return this.move(this.state.pause());
  }

  resume(): boolean {
    return this.move(this.state.resume());
  }

  abort(): boolean {
    return this.move(this.state.abort());
  }

  status(): string {
    if (this.version === "") return `${this.service} ${this.state.name}`;
    return `${this.service} ${this.state.name} ${this.version} ${String(this.state.percent)}%`;
  }

  // The extension round: the error rate decides the move.
  autoAdvance(errorRate: number): boolean {
    if (errorRate < 0 || errorRate > MAX_RATE)
      throw new RangeError("an error rate from 0 to 100");
    if (errorRate < ADVANCE_BELOW) return this.advance();
    if (errorRate > ABORT_ABOVE) return this.abort();
    return false;
  }
}
