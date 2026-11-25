"use strict";

function filled(text) {
  if (text === "") throw new RangeError("empty");
  return text;
}

// The user's bucket for this flag, 0 to 99: a hash, so it's stable across calls and
// clients, and different flags split users differently.
function bucket(flag, user) {
  let h = 0;
  for (const c of `${flag}:${user}`) h = (h * 31 + c.codePointAt(0)) % 1000003;
  return h % 100;
}

// The adapter side: each rule string from the server becomes a small rule object with
// one question, matches(flag, user, attrs).
class UserRule {
  #name;

  constructor(name) {
    this.#name = filled(name);
  }

  matches(_flag, user) {
    return user === this.#name;
  }
}

class AttrRule {
  #key;
  #value;

  constructor(text) {
    const eq = text.indexOf("=");
    if (eq < 0) throw new RangeError("attr:<key>=<value>");
    this.#key = filled(text.slice(0, eq));
    this.#value = filled(text.slice(eq + 1));
  }

  matches(_flag, _user, attrs) {
    return Object.hasOwn(attrs, this.#key) && attrs[this.#key] === this.#value;
  }
}

class PercentRule {
  #percent;

  constructor(text) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(text) || Number(text) > 100)
      throw new RangeError("0 to 100");
    this.#percent = Number(text);
  }

  matches(flag, user) {
    return bucket(flag, user) < this.#percent;
  }
}

const RULES = new Map([
  ["user", (rest) => new UserRule(rest)],
  ["attr", (rest) => new AttrRule(rest)],
  ["percent", (rest) => new PercentRule(rest)],
]);

function parseRule(text) {
  const colon = text.indexOf(":");
  // A rule without a ":" leaves nothing for the rule itself, and every rule needs it.
  const make = RULES.get(colon < 0 ? text : text.slice(0, colon));
  if (make === undefined) throw new RangeError("an unknown rule");
  return make(colon < 0 ? "" : text.slice(colon + 1));
}

// The facade: evaluate hides fetching, the local copy of the rules (a proxy for the flag
// server) and the rule types. Until a sync reaches the server it answers with the
// defaults; while the server is down it keeps answering from its last copy.
class FlagClient {
  #defaults;
  #server = new Map();
  #copy = new Map();
  #syncedAt = null;
  #overrides = new Map();

  constructor(defaults) {
    for (const flag of Object.keys(defaults)) filled(flag);
    this.#defaults = new Map(Object.entries(defaults));
  }

  serverRules(flag, rules, version) {
    filled(flag);
    if (version < 1) throw new RangeError("versions start at 1");
    const parsed = rules.map(parseRule);
    const current = this.#server.get(flag);
    if (current === undefined || version > current.version)
      this.#server.set(flag, { rules: parsed, version });
  }

  sync(nowMs, reachable) {
    if (!reachable) return false;
    this.#copy = new Map(
      [...this.#server].map(([flag, { rules }]) => [flag, rules]),
    );
    this.#syncedAt = nowMs;
    return true;
  }

  evaluate(flag, user, attrs) {
    filled(flag);
    filled(user);
    if (this.#overrides.has(flag)) return this.#overrides.get(flag);
    const rules = this.#copy.get(flag);
    if (rules !== undefined)
      return rules.some((rule) => rule.matches(flag, user, attrs));
    if (!this.#defaults.has(flag))
      throw new RangeError("no rules and no default");
    return this.#defaults.get(flag);
  }

  staleMs(nowMs) {
    if (this.#syncedAt === null) throw new RangeError("never synced");
    return nowMs - this.#syncedAt;
  }

  // The extension round: a local override wins over everything else.
  localOverride(flag, on) {
    this.#overrides.set(filled(flag), on);
  }
}

module.exports = { FlagClient };
