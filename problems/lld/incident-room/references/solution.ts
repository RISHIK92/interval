const MAX_MS = 1e15;

function named(...names: string[]): void {
  if (names.includes(""))
    throw new RangeError("ids, names and notes are not empty");
}

function timed(nowMs: number): void {
  if (nowMs < 0 || nowMs > MAX_MS)
    throw new RangeError("nowMs must be within 0 and 10^15");
}

// Owns its timeline: nothing outside the incident appends to it.
class Incident {
  commander: string;
  readonly responders: Set<string>;
  readonly declaredAt: number;
  resolvedAt: number | null = null;
  private lastMs: number;
  private readonly lines: string[] = [];

  constructor(commander: string, nowMs: number) {
    this.commander = commander;
    this.responders = new Set([commander]);
    this.declaredAt = nowMs;
    this.lastMs = nowMs;
    this.write(nowMs, `declared by ${commander}`);
  }

  notBefore(nowMs: number): void {
    if (nowMs < this.lastMs) throw new RangeError("time went backwards");
  }

  write(nowMs: number, text: string): void {
    this.lastMs = nowMs;
    this.lines.push(`${String(nowMs)} ${text}`);
  }

  timeline(): string[] {
    return [...this.lines];
  }
}

export class IncidentRoom {
  private readonly incidents = new Map<string, Incident>();

  private find(id: string): Incident {
    named(id);
    const incident = this.incidents.get(id);
    if (incident === undefined) throw new RangeError("unknown incident");
    return incident;
  }

  private at(id: string, nowMs: number): Incident {
    timed(nowMs);
    const incident = this.find(id);
    incident.notBefore(nowMs);
    return incident;
  }

  declareIncident(id: string, commander: string, nowMs: number): void {
    named(id, commander);
    timed(nowMs);
    if (this.incidents.has(id))
      throw new RangeError("incident already declared");
    this.incidents.set(id, new Incident(commander, nowMs));
  }

  joinIncident(id: string, responder: string, nowMs: number): boolean {
    named(responder);
    const incident = this.at(id, nowMs);
    if (incident.responders.has(responder)) return false;
    incident.responders.add(responder);
    incident.write(nowMs, `${responder} joined`);
    return true;
  }

  note(id: string, author: string, text: string, nowMs: number): boolean {
    named(author, text);
    const incident = this.at(id, nowMs);
    if (!incident.responders.has(author) || incident.resolvedAt !== null)
      return false;
    incident.write(nowMs, `${author}: ${text}`);
    return true;
  }

  handOff(id: string, to: string, nowMs: number): boolean {
    named(to);
    const incident = this.at(id, nowMs);
    if (!incident.responders.has(to) || to === incident.commander) return false;
    incident.write(nowMs, `${incident.commander} handed off to ${to}`);
    incident.commander = to;
    return true;
  }

  timeline(id: string): string[] {
    return this.find(id).timeline();
  }

  // The extension round: resolving closes the incident to notes.
  resolve(id: string, nowMs: number): boolean {
    const incident = this.at(id, nowMs);
    if (incident.resolvedAt !== null) return false;
    incident.resolvedAt = nowMs;
    incident.write(nowMs, "resolved");
    return true;
  }

  durationMs(id: string): number {
    const incident = this.find(id);
    if (incident.resolvedAt === null) throw new RangeError("not resolved yet");
    return incident.resolvedAt - incident.declaredAt;
  }
}
