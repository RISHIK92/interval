const WINDOW_MS = 60_000;

interface Payment {
  readonly customer: string;
  readonly cents: number;
  readonly country: string;
  readonly nowMs: number;
}

type Verdict = "allow" | "review" | "block";

// What the checks may look at besides the payment: shared by the whole chain.
class History {
  readonly blocked = new Set<string>();
  readonly home = new Map<string, string>();
  readonly recent = new Map<string, number[]>();

  remember(p: Payment): void {
    if (!this.home.has(p.customer)) this.home.set(p.customer, p.country);
    const times = this.recent.get(p.customer) ?? [];
    times.push(p.nowMs);
    // Times never decrease, so the ones that left the window are at the front.
    const kept = times.findIndex((t) => t > p.nowMs - WINDOW_MS);
    this.recent.set(p.customer, times.slice(kept));
  }

  count(customer: string): number {
    return this.recent.get(customer)?.length ?? 0;
  }
}

// One link: it decides the payment or returns null to pass it to the next link.
interface Check {
  readonly kind: string;
  decide(p: Payment, history: History): Verdict | null;
}

class Blocklist implements Check {
  readonly kind = "blocklist";

  decide(p: Payment, history: History): Verdict | null {
    return history.blocked.has(p.customer) ? "block" : null;
  }
}

class Velocity implements Check {
  readonly kind = "velocity";
  private readonly most: number;

  constructor(most: number) {
    this.most = most;
  }

  decide(p: Payment, history: History): Verdict | null {
    return history.count(p.customer) > this.most ? "review" : null;
  }
}

class AmountLimit implements Check {
  readonly kind = "amount";
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  decide(p: Payment): Verdict | null {
    return p.cents > this.limit ? "block" : null;
  }
}

class CountryMismatch implements Check {
  readonly kind = "country";

  decide(p: Payment, history: History): Verdict | null {
    return history.home.get(p.customer) !== p.country ? "review" : null;
  }
}

// Each kind with the least param it accepts; blocklist and country take none, so only 0.
const KINDS = new Map<
  string,
  { make: (param: number) => Check; low: number; takes: boolean }
>([
  ["blocklist", { make: () => new Blocklist(), low: 0, takes: false }],
  ["velocity", { make: (n) => new Velocity(n), low: 1, takes: true }],
  ["amount", { make: (n) => new AmountLimit(n), low: 0, takes: true }],
  ["country", { make: () => new CountryMismatch(), low: 0, takes: false }],
]);

export class RiskChain {
  private readonly checks: Check[] = [];
  private readonly history = new History();
  private readonly counts = new Map<string, number>([
    ["allow", 0],
    ["review", 0],
    ["block", 0],
  ]);
  private readonly skips = new Set<string>();

  addCheck(check: string, param: number): void {
    const kind = KINDS.get(check);
    if (kind === undefined) throw new Error("unknown check");
    if (param < kind.low || (param !== kind.low && !kind.takes))
      throw new Error("param out of range");
    this.checks.push(kind.make(param));
  }

  block(customer: string): void {
    if (customer === "") throw new Error("empty customer");
    this.history.blocked.add(customer);
  }

  assess(
    customer: string,
    cents: number,
    country: string,
    nowMs: number,
  ): string {
    if (customer === "" || country === "" || cents < 1)
      throw new Error("bad payment");
    const p: Payment = { customer, cents, country, nowMs };
    this.history.remember(p);
    let verdict: Verdict = "allow";
    for (const check of this.checks) {
      if (this.skips.has(JSON.stringify([customer, check.kind]))) continue;
      const decided = check.decide(p, this.history);
      if (decided !== null) {
        verdict = decided;
        break;
      }
    }
    this.counts.set(verdict, (this.counts.get(verdict) ?? 0) + 1);
    return verdict;
  }

  decisions(verdict: string): number {
    const count = this.counts.get(verdict);
    if (count === undefined) throw new Error("unknown verdict");
    return count;
  }

  // The extension round: trusted customers skip a kind of check.
  skipFor(customer: string, check: string): boolean {
    if (customer === "" || !KINDS.has(check)) throw new Error("bad skip");
    const key = JSON.stringify([customer, check]);
    if (this.skips.has(key)) return false;
    this.skips.add(key);
    return true;
  }
}
