function filled(text: string): string {
  if (text === "") throw new RangeError("empty");
  return text;
}

// The user's bucket for this flag, 0 to 99: a hash, so it's stable across calls and
// clients, and different flags split users differently.
function bucket(flag: string, user: string): number {
  let h = 0;
  for (const c of `${flag}:${user}`)
    h = (h * 31 + (c.codePointAt(0) ?? 0)) % 1000003;
  return h % 100;
}

// The adapter side: each rule string from the server becomes a small rule object.
interface Rule {
  matches(flag: string, user: string, attrs: Record<string, string>): boolean;
}

class UserRule implements Rule {
  private readonly name: string;

  constructor(name: string) {
    this.name = filled(name);
  }

  matches(_flag: string, user: string): boolean {
    return user === this.name;
  }
}

class AttrRule implements Rule {
  private readonly key: string;
  private readonly value: string;

  constructor(text: string) {
    const eq = text.indexOf("=");
    if (eq < 0) throw new RangeError("attr:<key>=<value>");
    this.key = filled(text.slice(0, eq));
    this.value = filled(text.slice(eq + 1));
  }

  matches(
    _flag: string,
    _user: string,
    attrs: Record<string, string>,
  ): boolean {
    return Object.hasOwn(attrs, this.key) && attrs[this.key] === this.value;
  }
}

class PercentRule implements Rule {
  private readonly percent: number;

  constructor(text: string) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(text) || Number(text) > 100)
      throw new RangeError("0 to 100");
    this.percent = Number(text);
  }

  matches(flag: string, user: string): boolean {
    return bucket(flag, user) < this.percent;
  }
}

const RULES: Record<string, (rest: string) => Rule> = {
  user: (rest) => new UserRule(rest),
  attr: (rest) => new AttrRule(rest),
  percent: (rest) => new PercentRule(rest),
};

function parseRule(text: string): Rule {
  const colon = text.indexOf(":");
  // A rule without a ":" leaves nothing for the rule itself, and every rule needs it.
  const kind = colon < 0 ? text : text.slice(0, colon);
  const make = Object.hasOwn(RULES, kind) ? RULES[kind] : undefined;
  if (make === undefined) throw new RangeError("an unknown rule");
  return make(colon < 0 ? "" : text.slice(colon + 1));
}

// The facade: evaluate hides fetching, the local copy of the rules (a proxy for the flag
// server) and the rule types. Until a sync reaches the server it answers with the
// defaults; while the server is down it keeps answering from its last copy.
export class FlagClient {
  private readonly defaults: Map<string, boolean>;
  private readonly server = new Map<
    string,
    { rules: Rule[]; version: number }
  >();
  private copy = new Map<string, Rule[]>();
  private syncedAt: number | null = null;
  private readonly overrides = new Map<string, boolean>();

  constructor(defaults: Record<string, boolean>) {
    for (const flag of Object.keys(defaults)) filled(flag);
    this.defaults = new Map(Object.entries(defaults));
  }

  serverRules(flag: string, rules: string[], version: number): void {
    filled(flag);
    if (version < 1) throw new RangeError("versions start at 1");
    const parsed = rules.map(parseRule);
    const current = this.server.get(flag);
    if (current === undefined || version > current.version)
      this.server.set(flag, { rules: parsed, version });
  }

  sync(nowMs: number, reachable: boolean): boolean {
    if (!reachable) return false;
    this.copy = new Map(
      [...this.server].map(([flag, { rules }]) => [flag, rules]),
    );
    this.syncedAt = nowMs;
    return true;
  }

  evaluate(flag: string, user: string, attrs: Record<string, string>): boolean {
    filled(flag);
    filled(user);
    const override = this.overrides.get(flag);
    if (override !== undefined) return override;
    const rules = this.copy.get(flag);
    if (rules !== undefined)
      return rules.some((rule) => rule.matches(flag, user, attrs));
    const fallback = this.defaults.get(flag);
    if (fallback === undefined) throw new RangeError("no rules and no default");
    return fallback;
  }

  staleMs(nowMs: number): number {
    if (this.syncedAt === null) throw new RangeError("never synced");
    return nowMs - this.syncedAt;
  }

  // The extension round: a local override wins over everything else.
  localOverride(flag: string, on: boolean): void {
    this.overrides.set(filled(flag), on);
  }
}
