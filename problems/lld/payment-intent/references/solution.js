"use strict";

const MAX_CENTS = 1_000_000_000;

function checkCents(cents) {
  if (cents < 1 || cents > MAX_CENTS)
    throw new RangeError("cents run from 1 to 10^9");
}

// One status and the operations it permits. Everything is refused unless a state says
// otherwise, so a new state only names what it allows.
class State {
  confirm(_intent) {
    return false;
  }

  settle(_intent, _succeeded) {
    return false;
  }

  capture(_intent, _cents) {
    return false;
  }

  refund(_intent, _cents) {
    return false;
  }

  dispute(_intent, _cents) {
    return false;
  }
}

class AwaitingPayment extends State {
  get name() {
    return "awaiting_payment";
  }

  confirm(intent) {
    intent.state = PROCESSING;
    return true;
  }
}

class Processing extends State {
  get name() {
    return "processing";
  }

  // A repeated confirm is a retry of the one that got here: accepted, no change.
  confirm(_intent) {
    return true;
  }

  settle(intent, succeeded) {
    intent.state = succeeded ? SUCCEEDED : FAILED;
    return true;
  }
}

class Failed extends State {
  get name() {
    return "failed";
  }

  settle(_intent, succeeded) {
    return !succeeded;
  }
}

class Succeeded extends State {
  get name() {
    return "succeeded";
  }

  settle(_intent, succeeded) {
    return succeeded;
  }

  capture(intent, cents) {
    if (cents > intent.amount - intent.captured) return false;
    intent.captured += cents;
    return true;
  }

  refund(intent, cents) {
    if (!intent.takeBack(cents)) return false;
    intent.state = REFUNDED;
    return true;
  }

  dispute(intent, cents) {
    return intent.disputeHeld(cents);
  }
}

class Refunded extends State {
  get name() {
    return "refunded";
  }

  refund(intent, cents) {
    return intent.takeBack(cents);
  }

  dispute(intent, cents) {
    return intent.disputeHeld(cents);
  }
}

class Disputed extends State {
  get name() {
    return "disputed";
  }
}

const AWAITING = new AwaitingPayment();
const PROCESSING = new Processing();
const FAILED = new Failed();
const SUCCEEDED = new Succeeded();
const REFUNDED = new Refunded();
const DISPUTED = new Disputed();

// The context: it holds the money and hands each operation to its current state.
class PaymentIntent {
  constructor(amountCents) {
    checkCents(amountCents);
    this.amount = amountCents;
    this.captured = 0;
    this.refunded = 0;
    this.state = AWAITING;
  }

  confirm() {
    return this.state.confirm(this);
  }

  settle(succeeded) {
    return this.state.settle(this, succeeded);
  }

  capture(cents) {
    checkCents(cents);
    return this.state.capture(this, cents);
  }

  refund(cents) {
    checkCents(cents);
    return this.state.refund(this, cents);
  }

  status() {
    return this.state.name;
  }

  takeBack(cents) {
    if (cents > this.captured - this.refunded) return false;
    this.refunded += cents;
    return true;
  }

  // The extension round: a chargeback freezes the payment.
  dispute(cents) {
    checkCents(cents);
    return this.state.dispute(this, cents);
  }

  disputeHeld(cents) {
    if (cents > this.captured - this.refunded) return false;
    this.state = DISPUTED;
    return true;
  }
}

module.exports = { PaymentIntent };
