"use strict";

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_LATENCY = 60_000;
const MAX_TOP = 100;

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function digits(text, most) {
  return new RegExp(`^[0-9]{1,${most}}$`).test(text) ? Number(text) : null;
}

// Parsing: one line in, one request ({ path, status, latency }) or null out. It knows the
// format and nothing else.
function parse(line) {
  const parts = line.split(" ");
  if (parts.length !== 4 || !METHODS.has(parts[0]) || !parts[1].startsWith("/"))
    return null;
  const status = digits(parts[2], 3);
  const latency = digits(parts[3], 5);
  if (
    status === null ||
    status < 100 ||
    status > 599 ||
    latency === null ||
    latency > MAX_LATENCY
  )
    return null;
  return { path: parts[1].split("?")[0], status, latency };
}

// Aggregation: running totals of what was parsed. It never sees a raw line or a report.
class Totals {
  constructor() {
    this.requests = 0;
    this.errors = 0;
    this.latencies = new Map();
    this.classes = new Map();
  }

  add(request) {
    this.requests += 1;
    if (request.status >= 500) this.errors += 1;
    if (!this.latencies.has(request.path)) this.latencies.set(request.path, []);
    this.latencies.get(request.path).push(request.latency);
    const statusClass = `${Math.floor(request.status / 100)}xx`;
    this.classes.set(statusClass, (this.classes.get(statusClass) ?? 0) + 1);
  }
}

// Reporting: answers computed from the totals, which it only reads.
function topPaths(totals, n) {
  const count = (path) => totals.latencies.get(path).length;
  return [...totals.latencies.keys()]
    .sort((a, b) => count(b) - count(a) || byCode(a, b))
    .slice(0, n);
}

function errorRate(totals) {
  return totals.requests > 0 ? totals.errors / totals.requests : 0;
}

function median(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

class AccessStats {
  constructor() {
    this.totals = new Totals();
  }

  ingest(line) {
    if (line === "") throw new Error("an empty line");
    const request = parse(line);
    if (request === null) return false;
    this.totals.add(request);
    return true;
  }

  topPaths(n) {
    if (n < 1 || n > MAX_TOP) throw new RangeError("n is 1 to 100");
    return topPaths(this.totals, n);
  }

  errorRate() {
    return errorRate(this.totals);
  }

  p50(path) {
    const latencies = this.totals.latencies.get(path);
    if (latencies === undefined) throw new Error("no requests for that path");
    return median(latencies);
  }

  // The extension round.
  byStatusClass() {
    return Object.fromEntries(this.totals.classes);
  }
}

module.exports = { AccessStats };
