"use strict";

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function filled(text) {
  if (text === "") throw new RangeError("names, keys and values are not empty");
}

// A prototype: anything made from it is a copy that shares no state with it. It remembers
// the variables it started with, so it can tell what changed since.
class Environment {
  constructor(variables) {
    this.variables = new Map(variables);
    this.started = new Map(variables);
  }

  copy() {
    return new Environment(this.variables);
  }
}

class EnvTemplates {
  #templates = new Map();
  #envs = new Map();

  #env(env) {
    const found = this.#envs.get(env);
    if (found === undefined) throw new RangeError("unknown environment");
    return found;
  }

  define(name, vars) {
    filled(name);
    for (const [key, value] of Object.entries(vars)) {
      filled(key);
      filled(value);
    }
    this.#templates.set(name, new Environment(Object.entries(vars)));
  }

  fork(base, env) {
    filled(env);
    const template = this.#templates.get(base);
    if (template === undefined) throw new RangeError("unknown template");
    if (this.#envs.has(env)) return false;
    this.#envs.set(env, template.copy());
    return true;
  }

  setVar(env, key, value) {
    const found = this.#env(env);
    filled(key);
    filled(value);
    if (found.variables.get(key) === value) return false;
    found.variables.set(key, value);
    return true;
  }

  vars(env) {
    return Object.fromEntries(this.#env(env).variables);
  }

  // The extension round: what an environment changed since it was forked.
  diff(env) {
    const found = this.#env(env);
    const out = [];
    for (const key of [...found.variables.keys()].sort(byCode)) {
      const value = found.variables.get(key);
      const was = found.started.get(key);
      if (was === undefined) out.push(`+${key}=${value}`);
      else if (was !== value) out.push(`~${key}=${value}`);
    }
    return out;
  }
}

module.exports = { EnvTemplates };
