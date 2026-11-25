from __future__ import annotations

from dataclasses import dataclass, field

MAX_CENTS = 10**7
# Tax rates in basis points (hundredths of a percent), so cents times a rate is in
# ten-thousandths of a cent.
RATES = {"us": 725, "eu": 2100, "jp": 1000}
BASIS = 10_000


def _cents(cents: int) -> None:
    if not 1 <= cents <= MAX_CENTS:
        raise ValueError("cents must be within 1 and 10^7")


@dataclass
class Account:
    """What the run knows about one customer between invoices."""

    usage: int = 0
    balance: int = 0
    rate: int = 0
    coupon: int = 0


@dataclass
class Draft:
    """An invoice on its way through the steps. `due` is what is still to be charged:
    each step reads it and takes its part off. Tax is held in ten-thousandths of a cent
    until the rounding step, so none is lost."""

    subtotal: int
    due: int
    credited: int = field(init=False)
    tax_exact: int = field(init=False)
    tax: int = field(init=False)


# Each step is one concern: it sees only what is due, never how earlier steps got there.
def subtotal(account: Account) -> Draft:
    return Draft(subtotal=account.usage, due=account.usage)


def discount(draft: Draft, account: Account) -> None:
    draft.due -= draft.due * account.coupon // 100


def credits(draft: Draft, account: Account) -> None:
    draft.credited = min(account.balance, draft.due)
    draft.due -= draft.credited


def tax(draft: Draft, account: Account) -> None:
    draft.tax_exact = draft.due * account.rate


def rounding(draft: Draft) -> None:
    cents, rest = divmod(draft.tax_exact, BASIS)
    draft.tax = cents + 1 if 2 * rest >= BASIS else cents


class InvoiceRun:
    def __init__(self) -> None:
        self._accounts: dict[str, Account] = {}

    def _account(self, customer: str) -> Account:
        if customer == "":
            raise ValueError("a customer has a name")
        return self._accounts.setdefault(customer, Account())

    def _known(self, customer: str) -> Account:
        found = self._accounts.get(customer)
        if found is None:
            raise ValueError("unknown customer")
        return found

    def usage(self, customer: str, cents: int) -> None:
        _cents(cents)
        self._account(customer).usage += cents

    def credit(self, customer: str, cents: int) -> None:
        _cents(cents)
        self._account(customer).balance += cents

    def region(self, customer: str, region: str) -> None:
        rate = RATES.get(region)
        if rate is None:
            raise ValueError("unknown region")
        self._account(customer).rate = rate

    def invoice(self, customer: str) -> list[int]:
        account = self._known(customer)
        draft = subtotal(account)
        discount(draft, account)
        credits(draft, account)
        tax(draft, account)
        rounding(draft)
        account.usage = 0
        account.balance -= draft.credited
        account.coupon = 0
        return [draft.subtotal, draft.credited, draft.tax, draft.due + draft.tax]

    def carryOver(self, customer: str) -> int:
        return self._known(customer).balance

    # The extension round: one more step, between the subtotal and the credits.
    def coupon(self, customer: str, percent: int) -> None:
        if not 1 <= percent <= 100:
            raise ValueError("percent must be within 1 and 100")
        self._account(customer).coupon = percent
