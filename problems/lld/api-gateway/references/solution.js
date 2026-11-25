"use strict";

const NONE = "-";

function checkPath(path) {
  if (!path.startsWith("/")) throw new RangeError("a path starts with /");
}

function checkPrefix(prefix) {
  checkPath(prefix);
  if (prefix !== "/" && prefix.endsWith("/"))
    throw new RangeError("only / itself ends with /");
}

function matches(prefix, path) {
  return prefix === "/" || path === prefix || path.startsWith(`${prefix}/`);
}

// Prefixes that match one path are nested, so the longest is the most specific.
function longest(prefixes, path) {
  let best;
  for (const prefix of prefixes)
    if (
      matches(prefix, path) &&
      (best === undefined || prefix.length > best.length)
    )
      best = prefix;
  return best;
}

// A fake upstream: answers with its statuses in order, then repeats the last.
class ScriptedService {
  #statuses;
  #served = 0;

  constructor(statuses) {
    this.#statuses = [...statuses];
  }

  answer() {
    const status =
      this.#statuses[Math.min(this.#served, this.#statuses.length - 1)];
    this.#served += 1;
    return status;
  }
}

// One prefix's settings and, when it caches, its own responses by path.
class Route {
  auth = false;
  ttl = 0;
  cached = new Map();

  constructor(service) {
    this.service = service;
  }
}

// The facade: one request call hides routing, the auth check, the response cache (a
// proxy in front of each service) and the services themselves.
class Gateway {
  #routes = new Map();
  #services = new Map();
  #rewrites = new Map();

  route(prefix, service) {
    checkPrefix(prefix);
    if (service === "") throw new RangeError("an empty service");
    const found = this.#routes.get(prefix);
    if (found === undefined) {
      this.#routes.set(prefix, new Route(service));
    } else {
      found.service = service;
      found.cached.clear();
    }
  }

  requireAuth(prefix) {
    this.#find(prefix).auth = true;
  }

  cache(prefix, ttlMs) {
    const route = this.#find(prefix);
    if (ttlMs < 1) throw new RangeError("a ttl is at least 1 ms");
    route.ttl = ttlMs;
  }

  upstream(service, statuses) {
    if (service === "" || statuses.length === 0)
      throw new RangeError("an empty service or script");
    if (statuses.some((s) => s < 100 || s > 599))
      throw new RangeError("not an HTTP status");
    this.#services.set(service, new ScriptedService(statuses));
  }

  request(path, token, nowMs) {
    checkPath(path);
    const rewrite = longest(this.#rewrites.keys(), path);
    if (rewrite !== undefined)
      path = this.#rewrites.get(rewrite) + path.slice(rewrite.length);
    const prefix = longest(this.#routes.keys(), path);
    if (prefix === undefined) return ["404", NONE, NONE];
    const route = this.#routes.get(prefix);
    if (route.auth && token === "") return ["401", NONE, NONE];
    const kept = route.cached.get(path);
    if (kept !== undefined && nowMs < kept.expires)
      return [String(kept.status), route.service, "hit"];
    const service = this.#services.get(route.service);
    if (service === undefined) return ["502", NONE, NONE];
    const status = service.answer();
    if (route.ttl === 0) return [String(status), route.service, NONE];
    if (status === 200)
      route.cached.set(path, { status, expires: nowMs + route.ttl });
    return [String(status), route.service, "miss"];
  }

  // The extension round: a path rewrite in front of the routing.
  rewrite(prefix, replacement) {
    checkPrefix(prefix);
    checkPrefix(replacement);
    if (prefix === "/" || replacement === "/")
      throw new RangeError("/ can't be rewritten or be a rewrite");
    this.#rewrites.set(prefix, replacement);
  }

  #find(prefix) {
    const route = this.#routes.get(prefix);
    if (route === undefined) throw new RangeError("no such route");
    return route;
  }
}

module.exports = { Gateway };
