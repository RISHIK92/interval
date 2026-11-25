function isInt(text: string): boolean {
  return /^-?[0-9]{1,15}$/.test(text);
}

// One check on one field's value; undefined when the field is absent.
interface Rule {
  violation(value: string | undefined): string | null;
}

class Required implements Rule {
  violation(value: string | undefined): string | null {
    return value === undefined ? "missing" : null;
  }
}

class IntRange implements Rule {
  private readonly low: number;
  private readonly high: number;

  constructor(low: number, high: number) {
    this.low = low;
    this.high = high;
  }

  violation(value: string | undefined): string | null {
    if (value === undefined) return null;
    if (!isInt(value)) return "not an integer";
    const n = Number(value);
    return n < this.low || n > this.high ? "out of range" : null;
  }
}

class OneOf implements Rule {
  private readonly items: readonly string[];

  constructor(items: readonly string[]) {
    this.items = items;
  }

  violation(value: string | undefined): string | null {
    return value === undefined || this.items.includes(value)
      ? null
      : "not allowed";
  }
}

function parse(spec: string): Rule {
  if (spec === "required") return new Required();
  const colon = spec.indexOf(":");
  const kind = colon < 0 ? spec : spec.slice(0, colon);
  const rest = colon < 0 ? "" : spec.slice(colon + 1);
  if (kind === "int") {
    const bounds = rest.split(":");
    if (bounds.length === 2 && bounds.every(isInt)) {
      const low = Number(bounds[0]);
      const high = Number(bounds[1]);
      if (low <= high) return new IntRange(low, high);
    }
  } else if (kind === "oneOf") {
    const items = rest.split(",");
    if (!items.includes("")) return new OneOf(items);
  }
  throw new RangeError("unknown spec");
}

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class ConfigSchema {
  private readonly rules = new Map<string, Rule[]>();
  private readonly fallbacks = new Map<string, string>();

  rule(field: string, spec: string): void {
    const parsed = parse(spec);
    if (
      field === "" ||
      (parsed instanceof Required && this.fallbacks.has(field))
    )
      throw new RangeError(
        "a field name is never empty, and this field can't take this rule",
      );
    const rules = this.rules.get(field) ?? [];
    rules.push(parsed);
    this.rules.set(field, rules);
  }

  check(env: Record<string, string>): string[] {
    const out: string[] = [];
    for (const field of this.fields()) {
      const value = Object.hasOwn(env, field)
        ? env[field]
        : this.fallbacks.get(field);
      for (const rule of this.rules.get(field) ?? []) {
        const problem = rule.violation(value);
        if (problem !== null) out.push(`${field}: ${problem}`);
      }
    }
    return out;
  }

  fields(): string[] {
    return [...this.rules.keys()].sort(byCode);
  }

  // The extension round.
  fallback(field: string, value: string): void {
    const rules = this.rules.get(field) ?? [];
    if (rules.length === 0 || rules.some((r) => r instanceof Required))
      throw new RangeError(
        "a fallback needs a field with rules and none required",
      );
    this.fallbacks.set(field, value);
  }
}
