"use strict";

const HOLE = "{}";

// The flyweight: a message pattern split once into its literal parts. It holds nothing
// about any one event, so every event with this pattern shares it.
class Template {
  #parts;

  constructor(pattern) {
    this.#parts = pattern.split(HOLE);
  }

  holes() {
    return this.#parts.length - 1;
  }

  render(params) {
    let out = this.#parts[0];
    params.forEach((param, i) => {
      out += param + this.#parts[i + 1];
    });
    return out;
  }
}

// Events keep only their own parameters and a reference to their template.
class LogStore {
  #templates = new Map();
  #events = new Map();
  #ids = new Map();
  #last = 0;

  log(pattern, params) {
    if (pattern === "" || params.includes(""))
      throw new RangeError("an empty pattern or parameter");
    const template = this.#templates.get(pattern) ?? new Template(pattern);
    if (template.holes() !== params.length)
      throw new RangeError("one parameter per {}");
    this.#templates.set(pattern, template);
    this.#last += 1;
    this.#events.set(this.#last, { template, params: [...params] });
    if (!this.#ids.has(pattern)) this.#ids.set(pattern, []);
    this.#ids.get(pattern).push(this.#last);
    return this.#last;
  }

  render(eventId) {
    const event = this.#events.get(eventId);
    if (event === undefined) throw new RangeError("unknown event");
    return event.template.render(event.params);
  }

  templates() {
    return this.#templates.size;
  }

  byPattern(pattern) {
    if (pattern === "") throw new RangeError("an empty pattern");
    return [...(this.#ids.get(pattern) ?? [])];
  }

  // The extension round: a pattern goes, and with it every event that shared it.
  purge(pattern) {
    if (pattern === "") throw new RangeError("an empty pattern");
    const ids = this.#ids.get(pattern) ?? [];
    this.#templates.delete(pattern);
    this.#ids.delete(pattern);
    for (const id of ids) this.#events.delete(id);
    return ids.length;
  }
}

module.exports = { LogStore };
