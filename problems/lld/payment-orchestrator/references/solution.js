"use strict";

const MAX_CENTS = 10_000_000;
const MAX_FEE_BPS = 1_000;
const MAX_FAILURES = 1_000;
const CARD_FIXED_CENTS = 30;
const BANK_CAP_CENTS = 500;
const FAILED = "failed";

// Each kind's fee is its own rule behind one contract, fee(cents, bps): given an amount and
// a rate in basis points, a fee in whole cents. A new kind is a new rule; nothing that
// charges changes.
const share = (cents, bps) => Math.floor((cents * bps) / 10_000);

class CardFee {
  fee(cents, bps) {
    return share(cents, bps) + CARD_FIXED_CENTS;
  }
}

class WalletFee {
  fee(cents, bps) {
    return share(cents, bps);
  }
}

class BankFee {
  fee(cents, bps) {
    return Math.min(share(cents, bps), BANK_CAP_CENTS);
  }
}

const FEES = new Map([
  ["card", new CardFee()],
  ["wallet", new WalletFee()],
  ["bank", new BankFee()],
]);

// A provider as the orchestrator sees it: something that may fail an attempt, and a fee.
class Provider {
  constructor(name, rule, bps) {
    this.name = name;
    this.rule = rule;
    this.bps = bps;
    this.failures = 0;
  }

  attempt() {
    if (this.failures === 0) return true;
    this.failures -= 1;
    return false;
  }

  fee(cents) {
    return this.rule.fee(cents, this.bps);
  }
}

// Settlement: what each provider owes the merchant, and what each charge can still refund.
class Ledger {
  constructor() {
    this.settled = new Map();
    this.captures = new Map();
  }

  open(provider) {
    this.settled.set(provider, 0);
  }

  capture(key, provider, cents) {
    this.captures.set(key, { provider: provider.name, left: cents });
    this.credit(provider.name, cents - provider.fee(cents));
  }

  refund(key, cents) {
    const capture = this.captures.get(key);
    if (capture === undefined || cents > capture.left) return false;
    capture.left -= cents;
    this.credit(capture.provider, -cents);
    return true;
  }

  credit(provider, cents) {
    this.settled.set(provider, this.settled.get(provider) + cents);
  }
}

// Routing: the order a charge tries providers in.
class Router {
  constructor() {
    this.rule = null;
  }

  order(providers, cents) {
    if (this.rule === null || cents < this.rule.threshold) return providers;
    const first = this.rule.provider;
    return [first, ...providers.filter((p) => p !== first)];
  }

  prefer(threshold, provider) {
    this.rule = { threshold, provider };
  }
}

function named(text) {
  if (text === "") throw new Error("an empty name");
  return text;
}

function checkedCents(cents) {
  if (cents < 1 || cents > MAX_CENTS)
    throw new RangeError("cents are 1 to 10^7");
  return cents;
}

class PaymentOrchestrator {
  constructor() {
    this.providers = new Map();
    this.outcomes = new Map();
    this.ledger = new Ledger();
    this.router = new Router();
  }

  provider(name, kind, feeBps) {
    const rule = FEES.get(kind);
    if (this.providers.has(named(name)) || rule === undefined)
      throw new Error("a new provider of a known kind");
    if (feeBps < 0 || feeBps > MAX_FEE_BPS)
      throw new RangeError("a fee is 0 to 1000 basis points");
    this.providers.set(name, new Provider(name, rule, feeBps));
    this.ledger.open(name);
  }

  failProvider(name, times) {
    if (times < 0 || times > MAX_FAILURES)
      throw new RangeError("times is 0 to 1000");
    this.known(name).failures = times;
  }

  charge(key, customer, cents, providers) {
    named(key);
    named(customer);
    checkedCents(cents);
    if (providers.length === 0 || new Set(providers).size !== providers.length)
      throw new Error("one or more distinct providers");
    const tried = this.router.order(providers, cents).map((p) => this.known(p));
    if (this.outcomes.has(key)) return this.outcomes.get(key);
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

  refund(key, cents) {
    if (!this.outcomes.has(named(key))) throw new Error("an unknown key");
    return this.ledger.refund(key, checkedCents(cents));
  }

  settled(provider) {
    return this.ledger.settled.get(this.known(provider).name);
  }

  // The extension round.
  routeByAmount(thresholdCents, provider) {
    this.router.prefer(checkedCents(thresholdCents), this.known(provider).name);
  }

  known(name) {
    const found = this.providers.get(name);
    if (found === undefined) throw new Error("an unknown provider");
    return found;
  }
}

module.exports = { PaymentOrchestrator };
