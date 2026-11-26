const ROLES: readonly string[] = ["qa", "security"];

// A colleague: it knows its own changes and sign-offs, never the other trains.
class Train {
  readonly name: string;
  readonly needs: readonly string[];
  readonly changes = new Map<string, string>(); // change -> team, in boarding order
  readonly signed = new Set<string>();
  departed = false;

  constructor(name: string, needs: readonly string[]) {
    this.name = name;
    this.needs = needs;
  }

  ready(): boolean {
    return this.needs.every((role) => this.signed.has(role));
  }

  take(change: string, team: string): void {
    this.changes.set(change, team);
    this.signed.clear();
  }

  drop(change: string): string {
    const team = this.changes.get(change) ?? "";
    this.changes.delete(change);
    this.signed.clear();
    return team;
  }
}

// The mediator: teams, reviewers and trains only talk to it, and it keeps the rule that
// any change to a train's contents voids its sign-offs.
export class ReleaseTrain {
  private readonly trains: Train[] = [];
  private readonly aboard = new Map<string, Train>();
  private readonly departed = new Set<string>();

  board(team: string, change: string): string {
    if (team === "" || change === "") throw new Error("empty name");
    if (this.aboard.has(change) || this.departed.has(change))
      throw new Error("the change has boarded");
    const train =
      this.trains.find((t) => this.boarding(t)) ?? this.newTrain(ROLES);
    train.take(change, team);
    this.aboard.set(change, train);
    return train.name;
  }

  signOff(role: string, train: string): boolean {
    if (!ROLES.includes(role)) throw new Error("unknown role");
    const t = this.train(train);
    if (
      t.departed ||
      t.changes.size === 0 ||
      !t.needs.includes(role) ||
      t.signed.has(role)
    )
      return false;
    t.signed.add(role);
    return true;
  }

  pull(change: string): boolean {
    if (change === "") throw new Error("empty change");
    const train = this.aboard.get(change);
    if (train === undefined) return false;
    this.aboard.delete(change);
    train.drop(change);
    return true;
  }

  depart(train: string): string[] {
    const t = this.train(train);
    if (t.departed || !t.ready()) return [];
    t.departed = true;
    const out: string[] = [];
    for (const [change, team] of t.changes) {
      this.aboard.delete(change);
      this.departed.add(change);
      out.push(`${team}:${change}`);
    }
    return out;
  }

  // The extension round: a hotfix leaves its train and departs alone.
  hotfix(change: string): string {
    const train = this.aboard.get(change);
    if (train === undefined || train.needs !== ROLES)
      throw new Error("not aboard a regular train");
    const alone = this.newTrain(["security"]);
    alone.take(change, train.drop(change));
    this.aboard.set(change, alone);
    return alone.name;
  }

  private boarding(t: Train): boolean {
    return !t.departed && t.needs === ROLES && !t.ready();
  }

  private newTrain(needs: readonly string[]): Train {
    const train = new Train(`T${String(this.trains.length + 1)}`, needs);
    this.trains.push(train);
    return train;
  }

  private train(name: string): Train {
    const found = this.trains.find((t) => t.name === name);
    if (found === undefined) throw new Error("unknown train");
    return found;
  }
}
