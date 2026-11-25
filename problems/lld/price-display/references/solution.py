from __future__ import annotations

from typing import NamedTuple

MAX_AMOUNT = 10**12
MAX_UNIT = 10**9
MAX_QTY = 1000


class Locale(NamedTuple):
    """How one locale writes an amount. Every line asks this one place, so the same
    amount reads the same wherever it's shown."""

    sign: str
    sign_first: bool
    grouping: str
    decimal: str

    def price(self, amount: int) -> str:
        if self.decimal:
            whole, minor = divmod(amount, 100)
            tail = f"{self.decimal}{minor:02d}"
        else:
            whole, tail = amount, ""
        digits = str(whole)
        ends = range(len(digits), 0, -3)
        groups = [digits[max(0, end - 3) : end] for end in reversed(ends)]
        number = self.grouping.join(groups) + tail
        return f"{self.sign}{number}" if self.sign_first else f"{number} {self.sign}"


def _amount(amount: int, most: int) -> int:
    if not 0 <= amount <= most:
        raise ValueError("amount out of range")
    return amount


class PriceFormatter:
    def __init__(self) -> None:
        self._locales: dict[str, Locale] = {
            "en-US": Locale("$", True, ",", "."),
            "de-DE": Locale("EUR", False, ".", ","),
            "ja-JP": Locale("JPY", False, ",", ""),
        }

    def _locale(self, locale: str) -> Locale:
        found = self._locales.get(locale)
        if found is None:
            raise ValueError("unknown locale")
        return found

    def checkoutLine(self, cents: int, locale: str) -> str:
        return "Total: " + self._locale(locale).price(_amount(cents, MAX_AMOUNT))

    def receiptLine(self, item: str, cents: int, qty: int, locale: str) -> str:
        if item == "":
            raise ValueError("an item has a name")
        if not 1 <= qty <= MAX_QTY:
            raise ValueError("qty must be within 1 and 1000")
        found = self._locale(locale)
        unit = _amount(cents, MAX_UNIT)
        return f"{item} {qty} x {found.price(unit)} = {found.price(unit * qty)}"

    def emailSummary(self, totalCents: int, locale: str) -> str:
        price = self._locale(locale).price(_amount(totalCents, MAX_AMOUNT))
        return f"Your order comes to {price}."

    # The extension round: a locale is data, so a new one changes no line's code.
    def addLocale(
        self,
        locale: str,
        currencySign: str,
        signFirst: bool,
        grouping: str,
        decimal: str,
    ) -> None:
        if locale == "" or locale in self._locales:
            raise ValueError("a locale needs a new, non-empty name")
        if currencySign == "":
            raise ValueError("a currency has a sign")
        self._locales[locale] = Locale(currencySign, signFirst, grouping, decimal)
