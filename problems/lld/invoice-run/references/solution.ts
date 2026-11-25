const MAX_CENTS = 10 ** 7;
// Tax rates in basis points (hundredths of a percent), so cents times a rate is in
// ten-thousandths of a cent.
const RATES = new Map<string, number>([
  ["us", 725],
  ["eu", 2100],
  ["jp", 1000],
]);
const BASIS = 10000;

function checkCents(cents: number): void {
  if (!(cents >= 1 && cents <= MAX_CENTS))
    throw new RangeError("cents must be within 1 and 10^7");
}

// What the run knows about one customer between invoices.
interface Account {
  usage: number;
  balance: number;
  rate: number;
  coupon: number;
}

// The invoice on its way through the steps. `due` is what is still to be charged: each
// step reads it and takes its part off. Tax stays in ten-thousandths of a cent until
// rounding.
interface Draft {
  subtotal: number;
  due: number;
  credited: number;
  taxExact: number;
  tax: number;
}

// Each step is one concern: it sees only what is due, never how earlier steps got there.
const subtotal = (account: Account): Draft => ({
  subtotal: account.usage,
  due: account.usage,
  credited: 0,
  taxExact: 0,
  tax: 0,
});

function discount(draft: Draft, account: Account): void {
  draft.due -= Math.floor((draft.due * account.coupon) / 100);
}

function credits(draft: Draft, account: Account): void {
  draft.credited = Math.min(account.balance, draft.due);
  draft.due -= draft.credited;
}

function tax(draft: Draft, account: Account): void {
  draft.taxExact = draft.due * account.rate;
}

function rounding(draft: Draft): void {
  const cents = Math.floor(draft.taxExact / BASIS);
  const rest = draft.taxExact % BASIS;
  draft.tax = 2 * rest >= BASIS ? cents + 1 : cents;
}

export class InvoiceRun {
  private readonly accounts = new Map<string, Account>();

  private account(customer: string): Account {
    if (customer === "") throw new RangeError("a customer has a name");
    let found = this.accounts.get(customer);
    if (found === undefined) {
      found = { usage: 0, balance: 0, rate: 0, coupon: 0 };
      this.accounts.set(customer, found);
    }
    return found;
  }

  private known(customer: string): Account {
    const found = this.accounts.get(customer);
    if (found === undefined) throw new RangeError("unknown customer");
    return found;
  }

  usage(customer: string, cents: number): void {
    checkCents(cents);
    this.account(customer).usage += cents;
  }

  credit(customer: string, cents: number): void {
    checkCents(cents);
    this.account(customer).balance += cents;
  }

  region(customer: string, region: string): void {
    const rate = RATES.get(region);
    if (rate === undefined) throw new RangeError("unknown region");
    this.account(customer).rate = rate;
  }

  invoice(customer: string): number[] {
    const account = this.known(customer);
    const draft = subtotal(account);
    discount(draft, account);
    credits(draft, account);
    tax(draft, account);
    rounding(draft);
    account.usage = 0;
    account.balance -= draft.credited;
    account.coupon = 0;
    return [draft.subtotal, draft.credited, draft.tax, draft.due + draft.tax];
  }

  carryOver(customer: string): number {
    return this.known(customer).balance;
  }

  // The extension round: one more step, between the subtotal and the credits.
  coupon(customer: string, percent: number): void {
    if (!(percent >= 1 && percent <= 100))
      throw new RangeError("percent must be within 1 and 100");
    this.account(customer).coupon = percent;
  }
}
