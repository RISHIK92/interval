"use strict";

const REFUSAL = "refused";
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// One thing a bot can do. A bot is the abilities it holds, never a subclass per mix.
class Acts {
  takesArgument = true;
  #done;

  constructor(done) {
    this.#done = done;
  }

  answer(bot, argument) {
    return `${this.#done} ${argument}`;
  }
}

class Status {
  takesArgument = false;

  answer(bot) {
    return `${bot} ok`;
  }
}

// Wraps any ability and logs each command it answers; the answer is unchanged.
class Audited {
  #verb;
  #inner;
  #log;

  constructor(verb, inner, log) {
    this.#verb = verb;
    this.#inner = inner;
    this.#log = log;
    this.takesArgument = inner.takesArgument;
  }

  answer(bot, argument) {
    const reply = this.#inner.answer(bot, argument);
    const command = this.takesArgument
      ? `${this.#verb} ${argument}`
      : this.#verb;
    this.#log.push(`${command} -> ${reply}`);
    return reply;
  }
}

const KNOWN = new Map([
  ["deploy", new Acts("deployed")],
  ["page", new Acts("paged")],
  ["query", new Acts("queried")],
  ["status", new Status()],
]);

function ability(name) {
  const found = KNOWN.get(name);
  if (found === undefined) throw new RangeError("unknown ability");
  return found;
}

class Bot {
  held = new Map();
  log = null;

  equip(name) {
    const base = ability(name);
    this.held.set(
      name,
      this.log === null ? base : new Audited(name, base, this.log),
    );
  }
}

class BotFleet {
  #bots = new Map();

  #bot(bot) {
    const found = this.#bots.get(bot);
    if (found === undefined) throw new RangeError("unknown bot");
    return found;
  }

  create(bot, abilities) {
    if (bot === "" || this.#bots.has(bot))
      throw new RangeError("a bot needs a new, non-empty name");
    abilities.forEach(ability);
    if (new Set(abilities).size !== abilities.length)
      throw new RangeError("an ability is listed twice");
    const made = new Bot();
    for (const name of abilities) made.equip(name);
    this.#bots.set(bot, made);
  }

  grant(bot, name) {
    const found = this.#bot(bot);
    ability(name);
    if (found.held.has(name)) return false;
    found.equip(name);
    return true;
  }

  revoke(bot, name) {
    const found = this.#bot(bot);
    ability(name);
    return found.held.delete(name);
  }

  handle(bot, command) {
    const found = this.#bot(bot);
    const space = command.indexOf(" ");
    const verb = space < 0 ? command : command.slice(0, space);
    const argument = space < 0 ? "" : command.slice(space + 1);
    const shape = ability(verb);
    const fits = shape.takesArgument ? argument !== "" : space < 0;
    if (!fits) throw new RangeError("the command doesn't fit its ability");
    const held = found.held.get(verb);
    return held === undefined ? REFUSAL : held.answer(bot, argument);
  }

  abilities(bot) {
    return [...this.#bot(bot).held.keys()].sort(byCode);
  }

  // The extension round: auditing wraps each ability the bot holds, now and later.
  audit(bot) {
    const found = this.#bot(bot);
    if (found.log !== null) return;
    found.log = [];
    for (const name of [...found.held.keys()]) found.equip(name);
  }

  auditLog(bot) {
    const log = this.#bot(bot).log;
    return log === null ? [] : [...log];
  }
}

module.exports = { BotFleet };
