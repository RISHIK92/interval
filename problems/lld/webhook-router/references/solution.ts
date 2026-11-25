interface Matcher {
  matches(event: string): boolean;
}

class Exact implements Matcher {
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  matches(event: string): boolean {
    return event === this.name;
  }
}

class Prefix implements Matcher {
  private readonly prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  matches(event: string): boolean {
    return event.startsWith(this.prefix);
  }
}

class Anything implements Matcher {
  matches(): boolean {
    return true;
  }
}

// Each kind of matcher recognises its own patterns. A new kind is a new entry here and a
// new class; the router and the existing kinds never change.
const KINDS: ((pattern: string) => Matcher | null)[] = [
  (pattern) => (pattern.includes("*") ? null : new Exact(pattern)),
  (pattern) => {
    const stem = pattern.slice(0, -2);
    return pattern.endsWith(".*") && stem !== "" && !stem.includes("*")
      ? new Prefix(stem + ".")
      : null;
  },
  (pattern) => (pattern === "*" ? new Anything() : null),
];

function matcher(pattern: string): Matcher {
  for (const kind of KINDS) {
    const found = kind(pattern);
    if (found !== null) return found;
  }
  throw new Error("not a pattern");
}

function named(text: string): string {
  if (text === "") throw new Error("an empty name");
  return text;
}

interface Route {
  pattern: string;
  handler: string;
  matcher: Matcher;
}

export class WebhookRouter {
  private routes: Route[] = [];
  private readonly exclusions = new Map<string, Map<string, Matcher>>();

  route(pattern: string, handler: string): void {
    const found = matcher(named(pattern));
    named(handler);
    if (
      !this.routes.some((r) => r.pattern === pattern && r.handler === handler)
    )
      this.routes.push({ pattern, handler, matcher: found });
  }

  deliver(event: string): string[] {
    if (named(event).includes("*")) throw new Error("an event has no wildcard");
    const handlers: string[] = [];
    for (const route of this.routes)
      if (
        !handlers.includes(route.handler) &&
        route.matcher.matches(event) &&
        !this.excluded(route.handler, event)
      )
        handlers.push(route.handler);
    return handlers;
  }

  unroute(handler: string): number {
    named(handler);
    const kept = this.routes.filter((r) => r.handler !== handler);
    const removed = this.routes.length - kept.length;
    this.routes = kept;
    this.exclusions.delete(handler);
    return removed;
  }

  // The extension round: a negative matcher is any matcher, used to skip a handler.
  exclude(handler: string, pattern: string): void {
    const found = matcher(named(pattern));
    const own =
      this.exclusions.get(named(handler)) ?? new Map<string, Matcher>();
    if (!own.has(pattern)) own.set(pattern, found);
    this.exclusions.set(handler, own);
  }

  private excluded(handler: string, event: string): boolean {
    for (const m of this.exclusions.get(handler)?.values() ?? [])
      if (m.matches(event)) return true;
    return false;
  }
}
