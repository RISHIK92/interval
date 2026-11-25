"use strict";

function isInt(text) {
  return /^-?[0-9]{1,15}$/.test(text);
}

// One check on one field's value; undefined when the field is absent.
class Required {
  violation(value) {
    return value === undefined ? "missing" : null;
  }
}

class IntRange {
  constructor(low, high) {
    this.low = low;
    this.high = high;
  }

  violation(value) {
    if (value === undefined) return null;
    if (!isInt(value)) return "not an integer";
    const n = Number(value);
    return n < this.low || n > this.high ? "out of range" : null;
  }
}

class OneOf {
  constructor(items) {
    this.items = items;
  }

  violation(value) {
    return value === undefined || this.items.includes(value)
      ? null
      : "not allowed";
  }
}

function parse(spec) {
  if (spec === "required") return new Required();
  const colon = spec.indexOf(":");
  const kind = colon < 0 ? spec : spec.slice(0, colon);
  const rest = colon < 0 ? "" : spec.slice(colon + 1);
  if (kind === "int") {
    const bounds = rest.split(":");
    if (bounds.length === 2 && bounds.every(isInt)) {
      const [low, high] = bounds.map(Number);
      if (low <= high) return new IntRange(low, high);
    }
  } else if (kind === "oneOf") {
    const items = rest.split(",");
    if (!items.includes("")) return new OneOf(items);
  }
  throw new RangeError("unknown spec");
}

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class ConfigSchema {
  #rules = new Map();
  #fallbacks = new Map();

  rule(field, spec) {
    const parsed = parse(spec);
    if (
      field === "" ||
      (parsed instanceof Required && this.#fallbacks.has(field))
    )
      throw new RangeError(
        "a field name is never empty, and this field can't take this rule",
      );
    if (!this.#rules.has(field)) this.#rules.set(field, []);
    this.#rules.get(field).push(parsed);
  }

  check(env) {
    const out = [];
    for (const field of this.fields()) {
      const value = Object.hasOwn(env, field)
        ? env[field]
        : this.#fallbacks.get(field);
      for (const rule of this.#rules.get(field)) {
        const problem = rule.violation(value);
        if (problem !== null) out.push(`${field}: ${problem}`);
      }
    }
    return out;
  }

  fields() {
    return [...this.#rules.keys()].sort(byCode);
  }

  // The extension round.
  fallback(field, value) {
    const rules = this.#rules.get(field) ?? [];
    if (rules.length === 0 || rules.some((r) => r instanceof Required))
      throw new RangeError(
        "a fallback needs a field with rules and none required",
      );
    this.#fallbacks.set(field, value);
  }
}

module.exports = { ConfigSchema };
