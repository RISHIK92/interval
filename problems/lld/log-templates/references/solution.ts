const HOLE = "{}";

// The flyweight: a message pattern split once into its literal parts. It holds nothing
// about any one event, so every event with this pattern shares it.
class Template {
  private readonly parts: readonly string[];

  constructor(pattern: string) {
    this.parts = pattern.split(HOLE);
  }

  holes(): number {
    return this.parts.length - 1;
  }

  render(params: readonly string[]): string {
    let out = this.parts[0] ?? "";
    params.forEach((param, i) => {
      out += param + (this.parts[i + 1] ?? "");
    });
    return out;
  }
}

interface LogEvent {
  template: Template;
  params: readonly string[];
}

// Events keep only their own parameters and a reference to their template.
export class LogStore {
  private readonly templatesByPattern = new Map<string, Template>();
  private readonly events = new Map<number, LogEvent>();
  private readonly ids = new Map<string, number[]>();
  private last = 0;

  log(pattern: string, params: string[]): number {
    if (pattern === "" || params.includes(""))
      throw new RangeError("an empty pattern or parameter");
    const template =
      this.templatesByPattern.get(pattern) ?? new Template(pattern);
    if (template.holes() !== params.length)
      throw new RangeError("one parameter per {}");
    this.templatesByPattern.set(pattern, template);
    this.last += 1;
    this.events.set(this.last, { template, params: [...params] });
    const ids = this.ids.get(pattern) ?? [];
    ids.push(this.last);
    this.ids.set(pattern, ids);
    return this.last;
  }

  render(eventId: number): string {
    const event = this.events.get(eventId);
    if (event === undefined) throw new RangeError("unknown event");
    return event.template.render(event.params);
  }

  templates(): number {
    return this.templatesByPattern.size;
  }

  byPattern(pattern: string): number[] {
    if (pattern === "") throw new RangeError("an empty pattern");
    return [...(this.ids.get(pattern) ?? [])];
  }

  // The extension round: a pattern goes, and with it every event that shared it.
  purge(pattern: string): number {
    if (pattern === "") throw new RangeError("an empty pattern");
    const ids = this.ids.get(pattern) ?? [];
    this.templatesByPattern.delete(pattern);
    this.ids.delete(pattern);
    for (const id of ids) this.events.delete(id);
    return ids.length;
  }
}
