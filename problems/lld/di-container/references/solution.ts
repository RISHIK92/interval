const LIFETIMES = new Set(["singleton", "transient", "scoped"]);

function given(value: string): void {
  if (value === "") throw new RangeError("empty");
}

// How to make one service: its lifetime, what it needs, and how many it has made. Each
// instance is its service's name and number, followed by the instances it was given, so
// the string shows exactly which instances are shared.
class Provider {
  readonly service: string;
  readonly lifetime: string;
  readonly deps: string[];
  made = 0;
  readonly wrappers: string[] = [];

  constructor(service: string, lifetime: string, deps: string[]) {
    this.service = service;
    this.lifetime = lifetime;
    this.deps = [...deps];
  }

  construct(deps: string[]): string {
    this.made += 1;
    let instance = `${this.service}#${String(this.made)}`;
    if (deps.length > 0) instance += `(${deps.join(",")})`;
    for (const wrapper of this.wrappers) instance = `${wrapper}[${instance}]`;
    return instance;
  }
}

// Services are registered with a lifetime and named dependencies, and nothing is made
// until something asks for it. The lifetime decides where an instance is kept: once for
// the container, once per scope, or nowhere (a new one every time).
export class DiContainer {
  private readonly providers = new Map<string, Provider>();
  private readonly singletons = new Map<string, string>();
  private readonly scopes = new Map<string, Map<string, string>>();

  provide(service: string, lifetime: string, deps: string[]): void {
    given(service);
    if (!LIFETIMES.has(lifetime)) throw new RangeError("unknown lifetime");
    deps.forEach(given);
    if (new Set(deps).size !== deps.length)
      throw new RangeError("a dependency listed twice");
    if (this.providers.has(service)) throw new RangeError("already provided");
    this.providers.set(service, new Provider(service, lifetime, deps));
  }

  resolve(service: string, scope: string): string {
    given(scope);
    // Check the whole graph first, so a resolve that fails constructs nothing.
    this.check(service, false, new Set(), new Set());
    return this.instance(service, scope);
  }

  constructed(service: string): number {
    return this.provider(service).made;
  }

  endScope(scope: string): number {
    given(scope);
    const size = this.scopes.get(scope)?.size ?? 0;
    this.scopes.delete(scope);
    return size;
  }

  // The extension round: wrapping a service without changing it.
  decorate(service: string, wrapper: string): void {
    given(wrapper);
    this.provider(service).wrappers.push(wrapper);
  }

  private provider(service: string): Provider {
    const found = this.providers.get(service);
    if (found === undefined) throw new RangeError("unknown service");
    return found;
  }

  private check(
    service: string,
    inSingleton: boolean,
    path: Set<string>,
    done: Set<string>,
  ): void {
    const provider = this.provider(service);
    if (path.has(service)) throw new RangeError("a dependency cycle");
    if (inSingleton && provider.lifetime === "scoped")
      throw new RangeError("a singleton would hold on to a scoped instance");
    const key = `${String(inSingleton)} ${service}`;
    if (done.has(key)) return;
    path.add(service);
    for (const dep of provider.deps)
      this.check(
        dep,
        inSingleton || provider.lifetime === "singleton",
        path,
        done,
      );
    path.delete(service);
    done.add(key);
  }

  private instance(service: string, scope: string): string {
    const provider = this.provider(service);
    let kept: Map<string, string> | null = null;
    if (provider.lifetime === "singleton") kept = this.singletons;
    else if (provider.lifetime === "scoped") {
      kept = this.scopes.get(scope) ?? new Map<string, string>();
      this.scopes.set(scope, kept);
    }
    const existing = kept?.get(service);
    if (existing !== undefined) return existing;
    const instance = provider.construct(
      provider.deps.map((dep) => this.instance(dep, scope)),
    );
    kept?.set(service, instance);
    return instance;
  }
}
