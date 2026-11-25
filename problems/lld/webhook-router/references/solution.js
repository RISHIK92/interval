"use strict";

// Three matchers with one method, matches(event).
class Exact {
  constructor(name) {
    this.name = name;
  }

  matches(event) {
    return event === this.name;
  }
}

class Prefix {
  constructor(prefix) {
    this.prefix = prefix;
  }

  matches(event) {
    return event.startsWith(this.prefix);
  }
}

class Anything {
  matches() {
    return true;
  }
}

// Each kind of matcher recognises its own patterns. A new kind is a new entry here and a
// new class; the router and the existing kinds never change.
const KINDS = [
  (pattern) => (pattern.includes("*") ? null : new Exact(pattern)),
  (pattern) => {
    const stem = pattern.slice(0, -2);
    return pattern.endsWith(".*") && stem !== "" && !stem.includes("*")
      ? new Prefix(stem + ".")
      : null;
  },
  (pattern) => (pattern === "*" ? new Anything() : null),
];

function matcher(pattern) {
  for (const kind of KINDS) {
    const found = kind(pattern);
    if (found !== null) return found;
  }
  throw new Error("not a pattern");
}

function named(text) {
  if (text === "") throw new Error("an empty name");
  return text;
}

class WebhookRouter {
  constructor() {
    this.routes = [];
    this.exclusions = new Map();
  }

  route(pattern, handler) {
    const found = matcher(named(pattern));
    named(handler);
    if (
      !this.routes.some((r) => r.pattern === pattern && r.handler === handler)
    )
      this.routes.push({ pattern, handler, matcher: found });
  }

  deliver(event) {
    if (named(event).includes("*")) throw new Error("an event has no wildcard");
    const handlers = [];
    for (const route of this.routes)
      if (
        !handlers.includes(route.handler) &&
        route.matcher.matches(event) &&
        !this.excluded(route.handler, event)
      )
        handlers.push(route.handler);
    return handlers;
  }

  unroute(handler) {
    named(handler);
    const kept = this.routes.filter((r) => r.handler !== handler);
    const removed = this.routes.length - kept.length;
    this.routes = kept;
    this.exclusions.delete(handler);
    return removed;
  }

  // The extension round: a negative matcher is any matcher, used to skip a handler.
  exclude(handler, pattern) {
    const found = matcher(named(pattern));
    const own = this.exclusions.get(named(handler)) ?? new Map();
    if (!own.has(pattern)) own.set(pattern, found);
    this.exclusions.set(handler, own);
  }

  excluded(handler, event) {
    for (const m of this.exclusions.get(handler)?.values() ?? [])
      if (m.matches(event)) return true;
    return false;
  }
}

module.exports = { WebhookRouter };
