const MAX_CENTS = 1_000_000_000;

function checkCents(cents: number): void {
  if (cents < 1 || cents > MAX_CENTS)
    throw new RangeError("cents run from 1 to 10^9");
}

// One status and the operations it permits. Everything is refused unless a state says
// otherwise, so a new state only names what it allows.
abstract class State {
  abstract readonly name: string;

  confirm(_intent: PaymentIntent): boolean {
    return false;
  }

  settle(_intent: PaymentIntent, _succeeded: boolean): boolean {
    return false;
  }

  capture(_intent: PaymentIntent, _cents: number): boolean {
    return false;
  }

  refund(_intent: PaymentIntent, _cents: number): boolean {
    return false;
  }

  dispute(_intent: PaymentIntent, _cents: number): boolean {
    return false;
  }
}

class AwaitingPayment extends State {
  readonly name = "awaiting_payment";

  override confirm(intent: PaymentIntent): boolean {
    intent.state = PROCESSING;
    return true;
  }
}

class Processing extends State {
  readonly name = "processing";

  // A repeated confirm is a retry of the one that got here: accepted, no change.
  override confirm(_intent: PaymentIntent): boolean {
    return true;
  }

  override settle(intent: PaymentIntent, succeeded: boolean): boolean {
    intent.state = succeeded ? SUCCEEDED : FAILED;
    return true;
  }
}

class Failed extends State {
  readonly name = "failed";

  override settle(_intent: PaymentIntent, succeeded: boolean): boolean {
    return !succeeded;
  }
}

class Succeeded extends State {
  readonly name = "succeeded";

  override settle(_intent: PaymentIntent, succeeded: boolean): boolean {
    return succeeded;
  }

  override capture(intent: PaymentIntent, cents: number): boolean {
    if (cents > intent.amount - intent.captured) return false;
    intent.captured += cents;
    return true;
  }

  override refund(intent: PaymentIntent, cents: number): boolean {
    if (!intent.takeBack(cents)) return false;
    intent.state = REFUNDED;
    return true;
  }

  override dispute(intent: PaymentIntent, cents: number): boolean {
    return intent.disputeHeld(cents);
  }
}

class Refunded extends State {
  readonly name = "refunded";

  override refund(intent: PaymentIntent, cents: number): boolean {
    return intent.takeBack(cents);
  }

  override dispute(intent: PaymentIntent, cents: number): boolean {
    return intent.disputeHeld(cents);
  }
}

class Disputed extends State {
  readonly name = "disputed";
}

const AWAITING = new AwaitingPayment();
const PROCESSING = new Processing();
const FAILED = new Failed();
const SUCCEEDED = new Succeeded();
const REFUNDED = new Refunded();
const DISPUTED = new Disputed();

// The context: it holds the money and hands each operation to its current state.
export class PaymentIntent {
  readonly amount: number;
  captured = 0;
  refunded = 0;
  state: State = AWAITING;

  constructor(amountCents: number) {
    checkCents(amountCents);
    this.amount = amountCents;
  }

  confirm(): boolean {
    return this.state.confirm(this);
  }

  settle(succeeded: boolean): boolean {
    return this.state.settle(this, succeeded);
  }

  capture(cents: number): boolean {
    checkCents(cents);
    return this.state.capture(this, cents);
  }

  refund(cents: number): boolean {
    checkCents(cents);
    return this.state.refund(this, cents);
  }

  status(): string {
    return this.state.name;
  }

  takeBack(cents: number): boolean {
    if (cents > this.captured - this.refunded) return false;
    this.refunded += cents;
    return true;
  }

  // The extension round: a chargeback freezes the payment.
  dispute(cents: number): boolean {
    checkCents(cents);
    return this.state.dispute(this, cents);
  }

  disputeHeld(cents: number): boolean {
    if (cents > this.captured - this.refunded) return false;
    this.state = DISPUTED;
    return true;
  }
}
