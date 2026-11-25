const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function filled(text: string): void {
  if (text === "") throw new RangeError("names, keys and values are not empty");
}

// A prototype: anything made from it is a copy that shares no state with it. It remembers
// the variables it started with, so it can tell what changed since.
class Environment {
  readonly variables: Map<string, string>;
  readonly started: ReadonlyMap<string, string>;

  constructor(variables: ReadonlyMap<string, string>) {
    this.variables = new Map(variables);
    this.started = new Map(variables);
  }

  copy(): Environment {
    return new Environment(this.variables);
  }
}

export class EnvTemplates {
  private readonly templates = new Map<string, Environment>();
  private readonly envs = new Map<string, Environment>();

  private env(env: string): Environment {
    const found = this.envs.get(env);
    if (found === undefined) throw new RangeError("unknown environment");
    return found;
  }

  define(name: string, vars: Record<string, string>): void {
    filled(name);
    for (const [key, value] of Object.entries(vars)) {
      filled(key);
      filled(value);
    }
    this.templates.set(name, new Environment(new Map(Object.entries(vars))));
  }

  fork(base: string, env: string): boolean {
    filled(env);
    const template = this.templates.get(base);
    if (template === undefined) throw new RangeError("unknown template");
    if (this.envs.has(env)) return false;
    this.envs.set(env, template.copy());
    return true;
  }

  setVar(env: string, key: string, value: string): boolean {
    const found = this.env(env);
    filled(key);
    filled(value);
    if (found.variables.get(key) === value) return false;
    found.variables.set(key, value);
    return true;
  }

  vars(env: string): Record<string, string> {
    return Object.fromEntries(this.env(env).variables);
  }

  // The extension round: what an environment changed since it was forked.
  diff(env: string): string[] {
    const found = this.env(env);
    const out: string[] = [];
    for (const key of [...found.variables.keys()].sort(byCode)) {
      const value = found.variables.get(key) ?? "";
      const was = found.started.get(key);
      if (was === undefined) out.push(`+${key}=${value}`);
      else if (was !== value) out.push(`~${key}=${value}`);
    }
    return out;
  }
}
