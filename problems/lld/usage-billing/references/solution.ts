const MAX_UNITS = 1e9;
const MAX_MINIMUM_CENTS = 1e9;
const MAX_RATE = 1e6;
const MAX_TIERS = 10;

interface Tier {
  start: number;
  rate: number;
}

function checkedTiers(tiers: number[][]): Tier[] {
  if (
    tiers.length < 1 ||
    tiers.length > MAX_TIERS ||
    tiers.some((t) => t.length !== 2)
  )
    throw new RangeError("1-10 tiers, each [start, centsPerUnit]");
  const out = tiers.map(([start = 0, rate = 0]) => ({ start, rate }));
  if (
    out[0]?.start !== 0 ||
    out.some((t, i) => i > 0 && t.start <= (out[i - 1]?.start ?? 0)) ||
    (out[out.length - 1]?.start ?? 0) > MAX_UNITS
  )
    throw new RangeError("starts begin at 0 and rise, up to 10^9");
  if (out.some((t) => t.rate < 0 || t.rate > MAX_RATE))
    throw new RangeError("rates within 0-10^6");
  return out;
}

// How a metric turns a customer's units into cents.
interface Pricing {
  charge(units: number): number;
}

class Graduated implements Pricing {
  private readonly tiers: Tier[];

  constructor(tiers: Tier[]) {
    this.tiers = tiers;
  }

  charge(units: number): number {
    let total = 0;
    let left = units;
    for (const { start, rate } of [...this.tiers].reverse()) {
      const above = Math.max(left - start, 0);
      total += above * rate;
      left -= above;
    }
    return total;
  }
}

class Volume implements Pricing {
  private readonly tiers: Tier[];

  constructor(tiers: Tier[]) {
    this.tiers = tiers;
  }

  charge(units: number): number {
    // The first tier starts at 0 and units are at least 1, so a tier is always found.
    const tier = [...this.tiers].reverse().find((t) => t.start < units);
    return units * (tier?.rate ?? 0);
  }
}

const MODELS = new Map<string, new (tiers: Tier[]) => Pricing>([
  ["graduated", Graduated],
  ["volume", Volume],
]);

export class UsageBilling {
  private readonly pricing = new Map<string, Pricing>();
  private readonly minimums = new Map<string, number>();
  private readonly usage = new Map<string, Map<string, number>>();

  price(metric: string, model: string, tiers: number[][]): void {
    const Model = MODELS.get(model);
    if (metric === "" || Model === undefined)
      throw new RangeError("a named metric and a known model");
    this.pricing.set(metric, new Model(checkedTiers(tiers)));
  }

  meter(customer: string, metric: string, units: number): void {
    if (
      customer === "" ||
      !this.pricing.has(metric) ||
      units < 1 ||
      units > MAX_UNITS
    )
      throw new RangeError("a customer, a priced metric and 1-10^9 units");
    let used = this.usage.get(customer);
    if (used === undefined) {
      used = new Map();
      this.usage.set(customer, used);
    }
    used.set(metric, (used.get(metric) ?? 0) + units);
  }

  private line(metric: string, units: number): number {
    const charge = this.pricing.get(metric)?.charge(units) ?? 0;
    const least = this.minimums.get(metric);
    return least === undefined ? charge : Math.max(charge, least);
  }

  invoice(customer: string): Record<string, number> {
    return Object.fromEntries(
      [...(this.usage.get(customer) ?? [])].map(([metric, units]) => [
        metric,
        this.line(metric, units),
      ]),
    );
  }

  total(customer: string): number {
    return Object.values(this.invoice(customer)).reduce((a, b) => a + b, 0);
  }

  // The extension round.
  minimum(metric: string, cents: number): void {
    if (!this.pricing.has(metric) || cents < 0 || cents > MAX_MINIMUM_CENTS)
      throw new RangeError("a priced metric and 0-10^9 cents");
    this.minimums.set(metric, cents);
  }
}
