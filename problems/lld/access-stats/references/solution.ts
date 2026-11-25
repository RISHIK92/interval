const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const MAX_LATENCY = 60_000;
const MAX_TOP = 100;

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Request {
  path: string;
  status: number;
  latency: number;
}

function digits(text: string, most: number): number | null {
  return new RegExp(`^[0-9]{1,${String(most)}}$`).test(text)
    ? Number(text)
    : null;
}

// Parsing: one line in, one request or nothing out. It knows the format and nothing else.
function parse(line: string): Request | null {
  const [method, path, statusText, latencyText, ...rest] = line.split(" ");
  if (
    rest.length > 0 ||
    method === undefined ||
    !METHODS.has(method) ||
    path === undefined ||
    !path.startsWith("/")
  )
    return null;
  const status = digits(statusText ?? "", 3);
  const latency = digits(latencyText ?? "", 5);
  if (
    status === null ||
    status < 100 ||
    status > 599 ||
    latency === null ||
    latency > MAX_LATENCY
  )
    return null;
  return { path: path.split("?")[0] ?? path, status, latency };
}

// Aggregation: running totals of what was parsed. It never sees a raw line or a report.
class Totals {
  requests = 0;
  errors = 0;
  readonly latencies = new Map<string, number[]>();
  readonly classes = new Map<string, number>();

  add(request: Request): void {
    this.requests += 1;
    if (request.status >= 500) this.errors += 1;
    const latencies = this.latencies.get(request.path) ?? [];
    latencies.push(request.latency);
    this.latencies.set(request.path, latencies);
    const statusClass = `${String(Math.floor(request.status / 100))}xx`;
    this.classes.set(statusClass, (this.classes.get(statusClass) ?? 0) + 1);
  }
}

// Reporting: answers computed from the totals, which it only reads.
function topPaths(totals: Totals, n: number): string[] {
  const count = (path: string) => totals.latencies.get(path)?.length ?? 0;
  return [...totals.latencies.keys()]
    .sort((a, b) => count(b) - count(a) || byCode(a, b))
    .slice(0, n);
}

function errorRate(totals: Totals): number {
  return totals.requests > 0 ? totals.errors / totals.requests : 0;
}

function median(latencies: number[]): number {
  const sorted = [...latencies].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

export class AccessStats {
  private readonly totals = new Totals();

  ingest(line: string): boolean {
    if (line === "") throw new Error("an empty line");
    const request = parse(line);
    if (request === null) return false;
    this.totals.add(request);
    return true;
  }

  topPaths(n: number): string[] {
    if (n < 1 || n > MAX_TOP) throw new RangeError("n is 1 to 100");
    return topPaths(this.totals, n);
  }

  errorRate(): number {
    return errorRate(this.totals);
  }

  p50(path: string): number {
    const latencies = this.totals.latencies.get(path);
    if (latencies === undefined) throw new Error("no requests for that path");
    return median(latencies);
  }

  // The extension round.
  byStatusClass(): Record<string, number> {
    return Object.fromEntries(this.totals.classes);
  }
}
