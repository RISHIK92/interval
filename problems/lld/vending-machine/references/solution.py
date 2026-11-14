from __future__ import annotations

import threading

COINS = (100, 25, 10, 5)


class VendingMachine:
    def __init__(self) -> None:
        self.slots: dict[str, list[object]] = {}
        self.coins: dict[int, int] = {c: 0 for c in COINS}
        self.pending: dict[int, int] = {c: 0 for c in COINS}
        # One lock for the whole machine: a purchase reads and moves the slot, the credit
        # and the coin inventory together.
        self.lock = threading.Lock()

    def _slot(self, slot: str) -> list[object]:
        if slot not in self.slots:
            raise KeyError("unknown slot")
        return self.slots[slot]

    def _coin(self, coin: int) -> None:
        if coin not in self.coins:
            raise ValueError("not a coin")

    def stock(self, slot: str, item: str, price: int, count: int) -> None:
        if slot == "" or item == "" or price <= 0 or count < 0:
            raise ValueError("invalid stock")
        with self.lock:
            self.slots[slot] = [item, price, count]

    def insert(self, coin: int) -> int:
        self._coin(coin)
        with self.lock:
            self.pending[coin] += 1
            return sum(c * n for c, n in self.pending.items())

    def balance(self) -> int:
        with self.lock:
            return sum(c * n for c, n in self.pending.items())

    def buy(self, slot: str) -> list[int]:
        with self.lock:
            entry = self._slot(slot)
            price, count = int(entry[1]), int(entry[2])  # type: ignore[call-overload]
            if count == 0:
                raise ValueError("sold out")
            credit = sum(c * n for c, n in self.pending.items())
            if credit < price:
                raise ValueError("not enough credit")
            avail = {c: self.coins[c] + self.pending[c] for c in COINS}
            rest = credit - price
            change: list[int] = []
            for c in COINS:
                take = min(rest // c, avail[c])
                change += [c] * take
                avail[c] -= take
                rest -= take * c
            if rest:
                raise ValueError("no exact change")
            self.coins = avail
            self.pending = {c: 0 for c in COINS}
            entry[2] = count - 1
            return change

    def refund(self) -> list[int]:
        with self.lock:
            out: list[int] = []
            for c in COINS:
                out += [c] * self.pending[c]
            self.pending = {c: 0 for c in COINS}
            return out

    def inventory(self, slot: str) -> int:
        with self.lock:
            return int(self._slot(slot)[2])  # type: ignore[call-overload]

    def item(self, slot: str) -> str:
        with self.lock:
            return str(self._slot(slot)[0])

    def restockCoins(self, coin: int, count: int) -> None:
        self._coin(coin)
        if count <= 0:
            raise ValueError("count must be positive")
        with self.lock:
            self.coins[coin] += count

    def coinStock(self, coin: int) -> int:
        self._coin(coin)
        with self.lock:
            return self.coins[coin]
