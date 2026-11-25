"use strict";

const MAX_MS = 1e15;

function named(...names) {
  if (names.includes(""))
    throw new RangeError("ids, names and notes are not empty");
}

function timed(nowMs) {
  if (nowMs < 0 || nowMs > MAX_MS)
    throw new RangeError("nowMs must be within 0 and 10^15");
}

// Owns its timeline: nothing outside the incident appends to it.
class Incident {
  constructor(commander, nowMs) {
    this.commander = commander;
    this.responders = new Set([commander]);
    this.declaredAt = nowMs;
    this.resolvedAt = null;
    this.lastMs = nowMs;
    this.lines = [];
    this.write(nowMs, `declared by ${commander}`);
  }

  write(nowMs, text) {
    this.lastMs = nowMs;
    this.lines.push(`${nowMs} ${text}`);
  }
}

class IncidentRoom {
  #incidents = new Map();

  #find(id) {
    named(id);
    const incident = this.#incidents.get(id);
    if (incident === undefined) throw new RangeError("unknown incident");
    return incident;
  }

  #at(id, nowMs) {
    timed(nowMs);
    const incident = this.#find(id);
    if (nowMs < incident.lastMs) throw new RangeError("time went backwards");
    return incident;
  }

  declareIncident(id, commander, nowMs) {
    named(id, commander);
    timed(nowMs);
    if (this.#incidents.has(id))
      throw new RangeError("incident already declared");
    this.#incidents.set(id, new Incident(commander, nowMs));
  }

  joinIncident(id, responder, nowMs) {
    named(responder);
    const incident = this.#at(id, nowMs);
    if (incident.responders.has(responder)) return false;
    incident.responders.add(responder);
    incident.write(nowMs, `${responder} joined`);
    return true;
  }

  note(id, author, text, nowMs) {
    named(author, text);
    const incident = this.#at(id, nowMs);
    if (!incident.responders.has(author) || incident.resolvedAt !== null)
      return false;
    incident.write(nowMs, `${author}: ${text}`);
    return true;
  }

  handOff(id, to, nowMs) {
    named(to);
    const incident = this.#at(id, nowMs);
    if (!incident.responders.has(to) || to === incident.commander) return false;
    incident.write(nowMs, `${incident.commander} handed off to ${to}`);
    incident.commander = to;
    return true;
  }

  timeline(id) {
    return [...this.#find(id).lines];
  }

  // The extension round: resolving closes the incident to notes.
  resolve(id, nowMs) {
    const incident = this.#at(id, nowMs);
    if (incident.resolvedAt !== null) return false;
    incident.resolvedAt = nowMs;
    incident.write(nowMs, "resolved");
    return true;
  }

  durationMs(id) {
    const incident = this.#find(id);
    if (incident.resolvedAt === null) throw new RangeError("not resolved yet");
    return incident.resolvedAt - incident.declaredAt;
  }
}

module.exports = { IncidentRoom };
