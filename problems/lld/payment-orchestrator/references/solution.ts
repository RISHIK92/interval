const MAX_CENTS = 10_000_000;
const MAX_FEE_BPS = 1_000;
const MAX_FAILURES = 1_000;
const CARD_FIXED_CENTS = 30;
const BANK_CAP_CENTS = 500;
const FAILED = "failed";

// Each kind's fee is its own rule behind one contract: given an amount and a rate in basis
// points, a fee in whole cents. A new kind is a new rule; nothing that charges changes.
interface FeeRule {
  fee(cents: number, bps: number): number;
}

const share = (cents: number, bps: number) =>
  Math.floor((cents * bps) / 10_000);

class CardFee implements FeeRule {
  fee(cents: number, bps: number): number {
    return share(cents, bps) + CARD_FIXED_CENTS;
  }
}

class WalletFee implements FeeRule {
  fee(cents: number, bps: number): number {
    return share(cents, bps);
  }
}

class BankFee implements FeeRule {
  fee(cents: number, bps: number): number {
    return Math.min(share(cents, bps), BANK_CAP_CENTS);
  }
}

const FEES = new Map<string, FeeRule>([
  ["card", new CardFee()],
  ["wallet", new WalletFee()],
  ["bank", new BankFee()],
]);

// A provider as the orchestrator sees it: something that may fail an attempt, and a fee.
class Provider {
  readonly name: string;
  failures = 0;
  private readonly rule: FeeRule;
  private readonly bps: number;

  constructor(name: string, rule: FeeRule, bps: number) {
    this.name = name;
    this.rule = rule;
    this.bps = bps;
  }

  attempt(): boolean {
    if (this.failures === 0) return true;
    this.failures -= 1;
    return false;
  }

  fee(cents: number): number {
    return this.rule.fee(cents, this.bps);
  }
}

// Settlement: what each provider owes the merchant, and what each charge can still refund.
class Ledger {
  readonly settled = new Map<string, number>();
  private readonly captures = new Map<
    string,
    { provider: string; left: number }
  >();

  open(provider: string): void {
    this.settled.set(provider, 0);
  }

  capture(key: string, provider: Provider, cents: number): void {
    this.captures.set(key, { provider: provider.name, left: cents });
    this.credit(provider.name, cents - provider.fee(cents));
  }

  refund(key: string, cents: number): boolean {
    const capture = this.captures.get(key);
    if (capture === undefined || cents > capture.left) return false;
    capture.left -= cents;
    this.credit(capture.provider, -cents);
    return true;
  }

  private credit(provider: string, cents: number): void {
    this.settled.set(provider, (this.settled.get(provider) ?? 0) + cents);
  }
}

// Routing: the order a charge tries providers in.
class Router {
  private rule: { threshold: number; provider: string } | null = null;

  order(providers: string[], cents: number): string[] {
    if (this.rule === null || cents < this.rule.threshold) return providers;
    const first = this.rule.provider;
    return [first, ...providers.filter((p) => p !== first)];
  }

  prefer(threshold: number, provider: string): void {
    this.rule = { threshold, provider };
  }
}

function named(text: string): string {
  if (text === "") throw new Error("an empty name");
  return text;
}

function checkedCents(cents: number): number {
  if (cents < 1 || cents > MAX_CENTS)
    throw new RangeError("cents are 1 to 10^7");
  return cents;
}

export class PaymentOrchestrator {
  private readonly providers = new Map<string, Provider>();
  private readonly outcomes = new Map<string, string>();
  private readonly ledger = new Ledger();
  private readonly router = new Router();

  provider(name: string, kind: string, feeBps: number): void {
    const rule = FEES.get(kind);
    if (this.providers.has(named(name)) || rule === undefined)
      throw new Error("a new provider of a known kind");
    if (feeBps < 0 || feeBps > MAX_FEE_BPS)
      throw new RangeError("a fee is 0 to 1000 basis points");
    this.providers.set(name, new Provider(name, rule, feeBps));
    this.ledger.open(name);
  }

  failProvider(name: string, times: number): void {
    if (times < 0 || times > MAX_FAILURES)
      throw new RangeError("times is 0 to 1000");
    this.known(name).failures = times;
  }

  charge(
    key: string,
    customer: string,
    cents: number,
    providers: string[],
  ): string {
    named(key);
    named(customer);
    checkedCents(cents);
    if (providers.length === 0 || new Set(providers).size !== providers.length)
      throw new Error("one or more distinct providers");
    const tried = this.router.order(providers, cents).map((p) => this.known(p));
    const known = this.outcomes.get(key);
    if (known !== undefined) return known;
    let outcome = FAILED;
    for (const provider of tried)
      if (provider.attempt()) {
        this.ledger.capture(key, provider, cents);
        outcome = `captured:${provider.name}`;
        break;
      }
    this.outcomes.set(key, outcome);
    return outcome;
  }

  refund(key: string, cents: number): boolean {
    if (!this.outcomes.has(named(key))) throw new Error("an unknown key");
    return this.ledger.refund(key, checkedCents(cents));
  }

  settled(provider: string): number {
    return this.ledger.settled.get(this.known(provider).name) ?? 0;
  }

  // The extension round.
  routeByAmount(thresholdCents: number, provider: string): void {
    this.router.prefer(checkedCents(thresholdCents), this.known(provider).name);
  }

  private known(name: string): Provider {
    const found = this.providers.get(name);
    if (found === undefined) throw new Error("an unknown provider");
    return found;
  }
}
