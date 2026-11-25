from __future__ import annotations

MAX_QTY = 10**9


def _named(*names: str) -> None:
    if "" in names:
        raise ValueError("skus and order ids are not empty")


def _counted(qty: int) -> None:
    if not 1 <= qty <= MAX_QTY:
        raise ValueError("qty must be within 1 and 10^9")


class Warehouse:
    """On hand = available + reserved, per SKU, after every call: the two maps change
    together and only here."""

    def __init__(self) -> None:
        self._on_hand: dict[str, int] = {}
        self._reserved: dict[str, int] = {}
        self._open: dict[str, tuple[str, int]] = {}
        self._used: set[str] = set()

    def receive(self, sku: str, qty: int) -> int:
        _named(sku)
        _counted(qty)
        self._on_hand[sku] = self._on_hand.get(sku, 0) + qty
        return self._on_hand[sku]

    def reserve(self, orderId: str, sku: str, qty: int) -> bool:
        _named(orderId, sku)
        _counted(qty)
        if orderId in self._used:
            raise ValueError("order id already used")
        if qty > self.available(sku):
            return False
        self._used.add(orderId)
        self._open[orderId] = (sku, qty)
        self._reserved[sku] = self._reserved.get(sku, 0) + qty
        return True

    def _close(self, orderId: str) -> tuple[str, int] | None:
        _named(orderId)
        order = self._open.pop(orderId, None)
        if order is not None:
            self._reserved[order[0]] -= order[1]
        return order

    def ship(self, orderId: str) -> bool:
        order = self._close(orderId)
        if order is None:
            return False
        self._on_hand[order[0]] -= order[1]
        return True

    def cancel(self, orderId: str) -> bool:
        return self._close(orderId) is not None

    def available(self, sku: str) -> int:
        _named(sku)
        return self._on_hand.get(sku, 0) - self._reserved.get(sku, 0)

    # The extension round: damaged stock leaves, but only from what's available.
    def writeOff(self, sku: str, qty: int) -> bool:
        _counted(qty)
        if qty > self.available(sku):
            return False
        self._on_hand[sku] -= qty
        return True
