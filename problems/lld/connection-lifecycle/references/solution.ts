type State = "idle" | "open" | "closed" | "failed";
type Action = "connect" | "disconnect" | "fail" | "reconnect";

// Every legal move: action -> (from -> to). Anything else is refused.
const MOVES: Record<Action, Partial<Record<State, State>>> = {
  connect: { idle: "open" },
  disconnect: { open: "closed" },
  fail: { idle: "failed", open: "failed" },
  reconnect: { failed: "open" },
};

export class Connection {
  private readonly host: string;
  private current: State = "idle";
  private reopened = 0;

  constructor(host: string) {
    if (host === "") throw new RangeError("a connection needs a host");
    this.host = host;
  }

  private move(action: Action): boolean {
    const to = MOVES[action][this.current];
    if (to === undefined) return false;
    this.current = to;
    return true;
  }

  connect(): boolean {
    return this.move("connect");
  }

  disconnect(): boolean {
    return this.move("disconnect");
  }

  fail(reason: string): void {
    if (reason === "") throw new RangeError("a failure needs a reason");
    this.move("fail");
  }

  state(): string {
    return this.current;
  }

  // The extension round.
  reconnect(): boolean {
    const moved = this.move("reconnect");
    if (moved) this.reopened += 1;
    return moved;
  }

  attempts(): number {
    return this.reopened;
  }
}
