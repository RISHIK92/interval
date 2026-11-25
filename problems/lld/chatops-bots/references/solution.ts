const REFUSAL = "refused";
const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// One thing a bot can do. A bot is the abilities it holds, never a subclass per mix.
interface Ability {
  readonly takesArgument: boolean;
  answer(bot: string, argument: string): string;
}

class Acts implements Ability {
  readonly takesArgument = true;
  private readonly done: string;

  constructor(done: string) {
    this.done = done;
  }

  answer(_bot: string, argument: string): string {
    return `${this.done} ${argument}`;
  }
}

class Status implements Ability {
  readonly takesArgument = false;

  answer(bot: string): string {
    return `${bot} ok`;
  }
}

// Wraps any ability and logs each command it answers; the answer is unchanged.
class Audited implements Ability {
  readonly takesArgument: boolean;
  private readonly verb: string;
  private readonly inner: Ability;
  private readonly log: string[];

  constructor(verb: string, inner: Ability, log: string[]) {
    this.verb = verb;
    this.inner = inner;
    this.log = log;
    this.takesArgument = inner.takesArgument;
  }

  answer(bot: string, argument: string): string {
    const reply = this.inner.answer(bot, argument);
    const command = this.takesArgument ? `${this.verb} ${argument}` : this.verb;
    this.log.push(`${command} -> ${reply}`);
    return reply;
  }
}

const KNOWN = new Map<string, Ability>([
  ["deploy", new Acts("deployed")],
  ["page", new Acts("paged")],
  ["query", new Acts("queried")],
  ["status", new Status()],
]);

function ability(name: string): Ability {
  const found = KNOWN.get(name);
  if (found === undefined) throw new RangeError("unknown ability");
  return found;
}

class Bot {
  readonly held = new Map<string, Ability>();
  log: string[] | null = null;

  equip(name: string): void {
    const base = ability(name);
    this.held.set(
      name,
      this.log === null ? base : new Audited(name, base, this.log),
    );
  }
}

export class BotFleet {
  private readonly bots = new Map<string, Bot>();

  private bot(bot: string): Bot {
    const found = this.bots.get(bot);
    if (found === undefined) throw new RangeError("unknown bot");
    return found;
  }

  create(bot: string, abilities: string[]): void {
    if (bot === "" || this.bots.has(bot))
      throw new RangeError("a bot needs a new, non-empty name");
    abilities.forEach((name) => ability(name));
    if (new Set(abilities).size !== abilities.length)
      throw new RangeError("an ability is listed twice");
    const made = new Bot();
    for (const name of abilities) made.equip(name);
    this.bots.set(bot, made);
  }

  grant(bot: string, name: string): boolean {
    const found = this.bot(bot);
    ability(name);
    if (found.held.has(name)) return false;
    found.equip(name);
    return true;
  }

  revoke(bot: string, name: string): boolean {
    const found = this.bot(bot);
    ability(name);
    return found.held.delete(name);
  }

  handle(bot: string, command: string): string {
    const found = this.bot(bot);
    const space = command.indexOf(" ");
    const verb = space < 0 ? command : command.slice(0, space);
    const argument = space < 0 ? "" : command.slice(space + 1);
    const shape = ability(verb);
    const fits = shape.takesArgument ? argument !== "" : space < 0;
    if (!fits) throw new RangeError("the command doesn't fit its ability");
    const held = found.held.get(verb);
    return held === undefined ? REFUSAL : held.answer(bot, argument);
  }

  abilities(bot: string): string[] {
    return [...this.bot(bot).held.keys()].sort(byCode);
  }

  // The extension round: auditing wraps each ability the bot holds, now and later.
  audit(bot: string): void {
    const found = this.bot(bot);
    if (found.log !== null) return;
    found.log = [];
    for (const name of [...found.held.keys()]) found.equip(name);
  }

  auditLog(bot: string): string[] {
    const log = this.bot(bot).log;
    return log === null ? [] : [...log];
  }
}
