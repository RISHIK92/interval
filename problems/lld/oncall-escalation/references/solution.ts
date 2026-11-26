// One link in the chain: its person is paged in turn, and when they don't acknowledge in
// time the page moves on to the next link, if there is one.
class Level {
  readonly person: string;
  readonly after: Level | null;

  constructor(person: string, after: Level | null) {
    this.person = person;
    this.after = after;
  }
}

interface Incident {
  level: Level;
  holder: string;
  since: number;
  acked: boolean;
}

export class Escalation {
  private readonly first: Level;
  private readonly people: Set<string>;
  private readonly timeout: number;
  private readonly incidents = new Map<string, Incident>();
  private readonly covers = new Map<string, string>();
  private now = 0;

  constructor(levels: string[], ackTimeoutMs: number) {
    if (
      levels.length === 0 ||
      levels.includes("") ||
      new Set(levels).size !== levels.length ||
      ackTimeoutMs < 1
    )
      throw new RangeError("bad levels or timeout");
    let first: Level | null = null;
    for (const person of [...levels].reverse())
      first = new Level(person, first);
    if (first === null) throw new RangeError("no levels");
    this.first = first;
    this.people = new Set(levels);
    this.timeout = ackTimeoutMs;
  }

  private clock(nowMs: number): void {
    if (nowMs < this.now) throw new RangeError("time went backwards");
    this.now = nowMs;
  }

  private paged(level: Level): string {
    return this.covers.get(level.person) ?? level.person;
  }

  page(incident: string, nowMs: number): string {
    if (incident === "" || this.incidents.has(incident))
      throw new RangeError("an empty or known incident");
    this.clock(nowMs);
    const holder = this.paged(this.first);
    this.incidents.set(incident, {
      level: this.first,
      holder,
      since: nowMs,
      acked: false,
    });
    return holder;
  }

  tick(nowMs: number): string[] {
    this.clock(nowMs);
    const moved: string[] = [];
    for (const name of [...this.incidents.keys()].sort()) {
      const incident = this.incidents.get(name);
      const after = incident?.level.after ?? null;
      if (
        incident === undefined ||
        incident.acked ||
        after === null ||
        nowMs - incident.since < this.timeout
      )
        continue;
      incident.level = after;
      incident.holder = this.paged(after);
      incident.since = nowMs;
      moved.push(`${name} -> ${incident.holder}`);
    }
    return moved;
  }

  ack(incident: string, person: string, nowMs: number): boolean {
    if (incident === "" || person === "") throw new RangeError("an empty name");
    this.clock(nowMs);
    const found = this.incidents.get(incident);
    if (found === undefined || found.acked || found.holder !== person)
      return false;
    found.acked = true;
    return true;
  }

  holder(incident: string): string | null {
    if (incident === "") throw new RangeError("an empty incident");
    return this.incidents.get(incident)?.holder ?? null;
  }

  // The extension round: holiday cover, applied whenever someone is paged from now on.
  cover(person: string, substitute: string): void {
    if (!this.people.has(person) || substitute === "")
      throw new RangeError("not on call, or an empty substitute");
    if (substitute === person) this.covers.delete(person);
    else this.covers.set(person, substitute);
  }
}
