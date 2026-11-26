from __future__ import annotations

MAX_CENTS = 1_000_000_000


def _cents(cents: int) -> None:
    if cents < 1 or cents > MAX_CENTS:
        raise ValueError("cents run from 1 to 10^9")


class State:
    """One status and the operations it permits. Everything is refused unless a state
    says otherwise, so a new state only names what it allows."""

    name = ""

    def confirm(self, intent: PaymentIntent) -> bool:
        return False

    def settle(self, intent: PaymentIntent, succeeded: bool) -> bool:
        return False

    def capture(self, intent: PaymentIntent, cents: int) -> bool:
        return False

    def refund(self, intent: PaymentIntent, cents: int) -> bool:
        return False

    def dispute(self, intent: PaymentIntent, cents: int) -> bool:
        return False


class AwaitingPayment(State):
    name = "awaiting_payment"

    def confirm(self, intent: PaymentIntent) -> bool:
        intent.state = PROCESSING
        return True


class Processing(State):
    name = "processing"

    def confirm(self, intent: PaymentIntent) -> bool:
        # A repeated confirm is a retry of the one that got here: accepted, no change.
        return True

    def settle(self, intent: PaymentIntent, succeeded: bool) -> bool:
        intent.state = SUCCEEDED if succeeded else FAILED
        return True


class Failed(State):
    name = "failed"

    def settle(self, intent: PaymentIntent, succeeded: bool) -> bool:
        return not succeeded


class Succeeded(State):
    name = "succeeded"

    def settle(self, intent: PaymentIntent, succeeded: bool) -> bool:
        return succeeded

    def capture(self, intent: PaymentIntent, cents: int) -> bool:
        if cents > intent.amount - intent.captured:
            return False
        intent.captured += cents
        return True

    def refund(self, intent: PaymentIntent, cents: int) -> bool:
        if not intent.take_back(cents):
            return False
        intent.state = REFUNDED
        return True

    def dispute(self, intent: PaymentIntent, cents: int) -> bool:
        return intent.dispute_held(cents)


class Refunded(State):
    name = "refunded"

    def refund(self, intent: PaymentIntent, cents: int) -> bool:
        return intent.take_back(cents)

    def dispute(self, intent: PaymentIntent, cents: int) -> bool:
        return intent.dispute_held(cents)


class Disputed(State):
    name = "disputed"


AWAITING = AwaitingPayment()
PROCESSING = Processing()
FAILED = Failed()
SUCCEEDED = Succeeded()
REFUNDED = Refunded()
DISPUTED = Disputed()


class PaymentIntent:
    """The context: it holds the money and hands each operation to its current state."""

    def __init__(self, amountCents: int) -> None:
        _cents(amountCents)
        self.amount = amountCents
        self.captured = 0
        self.refunded = 0
        self.state: State = AWAITING

    def confirm(self) -> bool:
        return self.state.confirm(self)

    def settle(self, succeeded: bool) -> bool:
        return self.state.settle(self, succeeded)

    def capture(self, cents: int) -> bool:
        _cents(cents)
        return self.state.capture(self, cents)

    def refund(self, cents: int) -> bool:
        _cents(cents)
        return self.state.refund(self, cents)

    def status(self) -> str:
        return self.state.name

    def take_back(self, cents: int) -> bool:
        if cents > self.captured - self.refunded:
            return False
        self.refunded += cents
        return True

    # The extension round: a chargeback freezes the payment.
    def dispute(self, cents: int) -> bool:
        _cents(cents)
        return self.state.dispute(self, cents)

    def dispute_held(self, cents: int) -> bool:
        if cents > self.captured - self.refunded:
            return False
        self.state = DISPUTED
        return True
