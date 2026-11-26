"use strict";

const ROLES = ["qa", "security"];

// A colleague: it knows its own changes and sign-offs, never the other trains.
class Train {
  constructor(name, needs) {
    this.name = name;
    this.needs = needs;
    this.changes = new Map(); // change -> team, in boarding order
    this.signed = new Set();
    this.departed = false;
  }

  ready() {
    return this.needs.every((role) => this.signed.has(role));
  }

  take(change, team) {
    this.changes.set(change, team);
    this.signed.clear();
  }

  drop(change) {
    const team = this.changes.get(change);
    this.changes.delete(change);
    this.signed.clear();
    return team;
  }
}

// The mediator: teams, reviewers and trains only talk to it, and it keeps the rule that
// any change to a train's contents voids its sign-offs.
class ReleaseTrain {
  constructor() {
    this.trains = [];
    this.aboard = new Map();
    this.departed = new Set();
  }

  board(team, change) {
    if (team === "" || change === "") throw new Error("empty name");
    if (this.aboard.has(change) || this.departed.has(change))
      throw new Error("the change has boarded");
    const train =
      this.trains.find((t) => this.boarding(t)) ?? this.newTrain(ROLES);
    train.take(change, team);
    this.aboard.set(change, train);
    return train.name;
  }

  signOff(role, train) {
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

  pull(change) {
    if (change === "") throw new Error("empty change");
    const train = this.aboard.get(change);
    if (train === undefined) return false;
    this.aboard.delete(change);
    train.drop(change);
    return true;
  }

  depart(train) {
    const t = this.train(train);
    if (t.departed || !t.ready()) return [];
    t.departed = true;
    const out = [];
    for (const [change, team] of t.changes) {
      this.aboard.delete(change);
      this.departed.add(change);
      out.push(`${team}:${change}`);
    }
    return out;
  }

  // The extension round: a hotfix leaves its train and departs alone.
  hotfix(change) {
    const train = this.aboard.get(change);
    if (train === undefined || train.needs !== ROLES)
      throw new Error("not aboard a regular train");
    const alone = this.newTrain(["security"]);
    alone.take(change, train.drop(change));
    this.aboard.set(change, alone);
    return alone.name;
  }

  boarding(t) {
    return !t.departed && t.needs === ROLES && !t.ready();
  }

  newTrain(needs) {
    const train = new Train(`T${this.trains.length + 1}`, needs);
    this.trains.push(train);
    return train;
  }

  train(name) {
    const found = this.trains.find((t) => t.name === name);
    if (found === undefined) throw new Error("unknown train");
    return found;
  }
}

module.exports = { ReleaseTrain };
