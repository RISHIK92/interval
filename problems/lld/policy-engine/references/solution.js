"use strict";

const ANY = "*";
const USER = "{user}";
const NO_MATCH = "no-match";
const SIMULATED = "(new)";
const HOURS = 24;

function checkNamed(...names) {
  if (names.includes("")) throw new RangeError("an empty name");
}

function hourPart(text) {
  if (!/^\d{1,2}$/.test(text))
    throw new RangeError("an hour is one or two digits");
  return Number(text);
}

// A resource pattern: literal characters, `*` for any run of characters, and `{user}`
// for the requesting user's name, matched literally.
class Glob {
  parts = []; // each one literal character, ANY or USER

  constructor(text) {
    text.split(USER).forEach((chunk, k) => {
      if (k > 0) this.parts.push(USER);
      for (const char of chunk) {
        if (char === "{" || char === "}")
          throw new RangeError("a brace outside {user}");
        this.parts.push(char);
      }
    });
  }

  matches(resource, user) {
    // null for ANY, otherwise one literal character.
    const items = this.parts.flatMap((part) =>
      part === USER ? [...user] : [part === ANY ? null : part],
    );
    // reach[j]: the items so far can match the first j characters.
    let reach = [true, ...Array(resource.length).fill(false)];
    for (const item of items) {
      const next = [];
      for (let j = 0; j <= resource.length; j++) {
        if (item === null)
          next.push((reach[j] ?? false) || (j > 0 && (next[j - 1] ?? false)));
        else
          next.push(
            j > 0 && (reach[j - 1] ?? false) && resource[j - 1] === item,
          );
      }
      reach = next;
    }
    return reach[resource.length] ?? false;
  }
}

// One parsed rule. A request it matches is decided by its effect.
class Policy {
  hours = null; // from, to (not included)

  constructor(id, text) {
    const words = text.split(" ").filter((w) => w !== "");
    const [effect = "", role = "", action = "", resource = ""] = words;
    if (
      (words.length !== 4 && words.length !== 6) ||
      (effect !== "allow" && effect !== "deny")
    )
      throw new RangeError("effect role action resource [during from-to]");
    this.id = id;
    this.effect = effect;
    this.role = role;
    this.action = action;
    this.resource = new Glob(resource);
    if (words.length === 6) {
      const hours = (words[5] ?? "").split("-");
      if (words[4] !== "during" || hours.length !== 2)
        throw new RangeError("during from-to");
      const start = hourPart(hours[0] ?? "");
      const end = hourPart(hours[1] ?? "");
      if (start >= end || end > HOURS)
        throw new RangeError("hours run forward, up to 24");
      this.hours = [start, end];
    }
  }

  matches(user, roles, action, resource, hour) {
    return (
      (this.role === ANY || roles.includes(this.role)) &&
      (this.action === ANY || this.action === action) &&
      (this.hours === null ||
        (this.hours[0] <= hour && hour < this.hours[1])) &&
      this.resource.matches(resource, user)
    );
  }
}

function decideWith(policies, user, roles, action, resource, hour) {
  checkNamed(user, action, resource, ...roles);
  if (hour < 0 || hour >= HOURS)
    throw new RangeError("an hour runs from 0 to 23");
  // A chain of responsibility in two passes: any deny that matches decides first, then
  // the earliest allow; with neither, the request falls off the chain.
  for (const effect of ["deny", "allow"])
    for (const p of policies)
      if (p.effect === effect && p.matches(user, roles, action, resource, hour))
        return `${effect}:${p.id}`;
  return NO_MATCH;
}

class PolicyEngine {
  policies = [];

  addPolicy(id, text) {
    checkNamed(id);
    const policy = new Policy(id, text);
    if (this.policies.some((p) => p.id === id)) return false;
    this.policies.push(policy);
    return true;
  }

  removePolicy(id) {
    checkNamed(id);
    const kept = this.policies.filter((p) => p.id !== id);
    const removed = kept.length < this.policies.length;
    this.policies = kept;
    return removed;
  }

  decide(user, roles, action, resource, hour) {
    return decideWith(this.policies, user, roles, action, resource, hour);
  }

  // The extension round: a decision as if one more policy existed.
  simulate(text, user, roles, action, resource, hour) {
    const policies = [...this.policies, new Policy(SIMULATED, text)];
    return decideWith(policies, user, roles, action, resource, hour);
  }
}

module.exports = { PolicyEngine };
