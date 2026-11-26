"use strict";

// One link in the chain: its person is paged in turn, and when they don't acknowledge in
// time the page moves on to the next link, if there is one.
class Level {
  constructor(person, after) {
    this.person = person;
    this.after = after;
  }
}

class Escalation {
  #first;
  #people;
  #timeout;
  #incidents = new Map();
  #covers = new Map();
  #now = 0;

  constructor(levels, ackTimeoutMs) {
    if (
      levels.length === 0 ||
      levels.includes("") ||
      new Set(levels).size !== levels.length ||
      ackTimeoutMs < 1
    )
      throw new RangeError("bad levels or timeout");
    let first = null;
    for (const person of [...levels].reverse())
      first = new Level(person, first);
    this.#first = first;
    this.#people = new Set(levels);
    this.#timeout = ackTimeoutMs;
  }

  #clock(nowMs) {
    if (nowMs < this.#now) throw new RangeError("time went backwards");
    this.#now = nowMs;
  }

  #paged(level) {
    return this.#covers.get(level.person) ?? level.person;
  }

  page(incident, nowMs) {
    if (incident === "" || this.#incidents.has(incident))
      throw new RangeError("an empty or known incident");
    this.#clock(nowMs);
    const holder = this.#paged(this.#first);
    this.#incidents.set(incident, {
      level: this.#first,
      holder,
      since: nowMs,
      acked: false,
    });
    return holder;
  }

  tick(nowMs) {
    this.#clock(nowMs);
    const moved = [];
    for (const name of [...this.#incidents.keys()].sort()) {
      const incident = this.#incidents.get(name);
      const after = incident.level.after;
      if (
        incident.acked ||
        after === null ||
        nowMs - incident.since < this.#timeout
      )
        continue;
      incident.level = after;
      incident.holder = this.#paged(after);
      incident.since = nowMs;
      moved.push(`${name} -> ${incident.holder}`);
    }
    return moved;
  }

  ack(incident, person, nowMs) {
    if (incident === "" || person === "") throw new RangeError("an empty name");
    this.#clock(nowMs);
    const found = this.#incidents.get(incident);
    if (found === undefined || found.acked || found.holder !== person)
      return false;
    found.acked = true;
    return true;
  }

  holder(incident) {
    if (incident === "") throw new RangeError("an empty incident");
    return this.#incidents.get(incident)?.holder ?? null;
  }

  // The extension round: holiday cover, applied whenever someone is paged from now on.
  cover(person, substitute) {
    if (!this.#people.has(person) || substitute === "")
      throw new RangeError("not on call, or an empty substitute");
    if (substitute === person) this.#covers.delete(person);
    else this.#covers.set(person, substitute);
  }
}

module.exports = { Escalation };
