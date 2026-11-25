"use strict";

function named(...names) {
  if (names.includes("")) throw new RangeError("names are not empty");
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Teams aggregate engineers: a team holds its members' names in join order, and each
// engineer knows their teams. Disbanding drops only the team's side and the links.
class OncallRoster {
  #teamsOf = new Map();
  #members = new Map();
  #lastOnCall = new Map();

  addEngineer(name) {
    named(name);
    if (this.#teamsOf.has(name))
      throw new RangeError("engineer already on the roster");
    this.#teamsOf.set(name, new Set());
  }

  addTeam(team) {
    named(team);
    if (this.#members.has(team)) throw new RangeError("team already exists");
    this.#members.set(team, []);
  }

  join(team, name) {
    named(team, name);
    const members = this.#members.get(team);
    const teams = this.#teamsOf.get(name);
    if (members === undefined || teams === undefined)
      throw new RangeError("unknown team or engineer");
    if (teams.has(team)) return false;
    members.push(name);
    teams.add(team);
    return true;
  }

  disband(team) {
    named(team);
    const members = this.#members.get(team);
    if (members === undefined) return false;
    this.#members.delete(team);
    for (const name of members) this.#teamsOf.get(name).delete(team);
    this.#lastOnCall.delete(team);
    return true;
  }

  teamsOf(name) {
    named(name);
    const teams = this.#teamsOf.get(name);
    if (teams === undefined) throw new RangeError("unknown engineer");
    return [...teams].sort(byCode);
  }

  // The extension round: the next on call, in join order.
  rotate(team) {
    named(team);
    const members = this.#members.get(team);
    if (members === undefined || members.length === 0)
      throw new RangeError("unknown team or no members");
    const next = ((this.#lastOnCall.get(team) ?? -1) + 1) % members.length;
    this.#lastOnCall.set(team, next);
    return members[next];
  }
}

module.exports = { OncallRoster };
