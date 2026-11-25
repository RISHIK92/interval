from __future__ import annotations

LIMIT = 10**12
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _checked(cents: int, currency: str) -> None:
    if not 0 <= cents <= LIMIT:
        raise ValueError("cents must be within 0 and 10^12")
    if len(currency) != 3 or any(c not in LETTERS for c in currency):
        raise ValueError("a currency is three capital letters")


class Money:
    def __init__(self, cents: int, currency: str) -> None:
        _checked(cents, currency)
        self._cents = cents
        self._currency = currency

    def _show(self, cents: int) -> str:
        return f"{self._currency} {cents // 100}.{cents % 100:02d}"

    def add(self, cents: int, currency: str) -> str:
        _checked(cents, currency)
        if currency != self._currency:
            raise ValueError("can't add across currencies")
        return self._show(self._cents + cents)

    def split(self, parts: int) -> list[str]:
        if not 1 <= parts <= 100:
            raise ValueError("parts must be within 1-100")
        share, left = divmod(self._cents, parts)
        return [self._show(share + (1 if i < left else 0)) for i in range(parts)]

    def display(self) -> str:
        return self._show(self._cents)

    # The extension round.
    def allocate(self, weights: list[int]) -> list[str]:
        if not 1 <= len(weights) <= 100 or any(not 0 <= w <= 1000 for w in weights):
            raise ValueError("1-100 weights, each within 0-1000")
        total = sum(weights)
        if total < 1:
            raise ValueError("at least one weight above 0")
        shares = [self._cents * w // total for w in weights]
        left = self._cents - sum(shares)
        for i, w in enumerate(weights):
            if left > 0 and w > 0:
                shares[i] += 1
                left -= 1
        return [self._show(s) for s in shares]
