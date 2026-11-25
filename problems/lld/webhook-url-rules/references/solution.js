"use strict";

const MAX_LENGTH = 200;

// The URL's host in lower case: after the first "://", up to the path, query or
// fragment, without a port. Empty when there's no "://".
function hostOf(url) {
  const at = url.indexOf("://");
  if (at < 0) return "";
  let rest = url.slice(at + 3);
  for (const stop of ["/", "?", "#"]) rest = rest.split(stop)[0];
  return rest.split(":")[0].toLowerCase();
}

function ipv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^[0-9]{1,3}$/.test(p)))
    return null;
  const numbers = parts.map(Number);
  return numbers.every((n) => n <= 255) ? numbers : null;
}

function internal(host) {
  if (host === "" || host === "localhost") return true;
  const ip = ipv4(host);
  if (ip === null) return false;
  const [first, second] = ip;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

// The one place the URL rules live. Every entry point asks it, so a new rule is one
// change here and can never apply at one entry point and not another.
class UrlPolicy {
  #blocked = new Set();

  block(host) {
    this.#blocked.add(host.toLowerCase());
  }

  violations(url) {
    if (url === "") throw new RangeError("a URL is not empty");
    const host = hostOf(url);
    const found = [];
    if (url.length > MAX_LENGTH) found.push("length");
    if (!url.startsWith("https://")) found.push("scheme");
    if (internal(host)) found.push("host");
    if (this.#blocked.has(host)) found.push("blocked");
    return found;
  }
}

class WebhookRules {
  #policy = new UrlPolicy();
  #urls = new Map(); // id -> URL, in creation order

  createHook(url) {
    const found = this.#policy.violations(url);
    if (found.length === 0) this.#urls.set(`hook-${this.#urls.size + 1}`, url);
    return found;
  }

  updateHook(hookId, url) {
    if (!this.#urls.has(hookId)) throw new RangeError("no such hook");
    const found = this.#policy.violations(url);
    if (found.length === 0) this.#urls.set(hookId, url);
    return found;
  }

  testUrl(url) {
    return this.#policy.violations(url);
  }

  hooks() {
    return [...this.#urls].map(([id, url]) => `${id} ${url}`);
  }

  // The extension round: one more rule, in the one place rules live.
  blockHost(host) {
    if (host === "") throw new RangeError("a host is not empty");
    this.#policy.block(host);
  }
}

module.exports = { WebhookRules };
