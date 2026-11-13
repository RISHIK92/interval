from __future__ import annotations

import functools
import threading
from collections import deque

MAX = 1_000_000


def locked(method):  # type: ignore[no-untyped-def]
    @functools.wraps(method)
    def run(self, *args):  # type: ignore[no-untyped-def]
        with self.lock:
            return method(self, *args)

    return run


class OrderBook:
    def __init__(self) -> None:
        # Open orders per side: price -> ids in time priority, oldest first.
        self.levels: dict[str, dict[int, deque[str]]] = {"buy": {}, "sell": {}}
        # Every id ever accepted: [side, price, open quantity, state]. Ids are never reused.
        self.orders: dict[str, list] = {}
        # The extension round: all quantity matched so far.
        self.matched = 0
        self.lock = threading.RLock()

    @staticmethod
    def _side(side: str) -> None:
        if side != "buy" and side != "sell":
            raise ValueError("side must be buy or sell")

    def _open(self, order_id: str) -> list:
        order = self.orders.get(order_id)
        if order is None:
            raise KeyError("unknown id")
        if order[3] != "open":
            raise ValueError("order is not open")
        return order

    @locked
    def place(self, id: str, side: str, price: int, qty: int) -> list[str]:
        self._side(side)
        if price < 1 or price > MAX:
            raise ValueError("price out of range")
        if qty < 1 or qty > MAX:
            raise ValueError("quantity out of range")
        if id == "":
            raise ValueError("empty id")
        if id in self.orders:
            raise ValueError("duplicate id")
        other = "sell" if side == "buy" else "buy"
        fills: list[str] = []
        while qty > 0 and self.levels[other]:
            best = min(self.levels[other]) if side == "buy" else max(self.levels[other])
            if (side == "buy" and best > price) or (side == "sell" and best < price):
                break
            queue = self.levels[other][best]
            maker = self.orders[queue[0]]
            took = min(qty, maker[2])
            fills.append(f"{queue[0]}:{best}:{took}")
            qty -= took
            maker[2] -= took
            self.matched += took
            if maker[2] == 0:
                maker[3] = "filled"
                queue.popleft()
                if not queue:
                    del self.levels[other][best]
        if qty > 0:
            self.orders[id] = [side, price, qty, "open"]
            self.levels[side].setdefault(price, deque()).append(id)
        else:
            self.orders[id] = [side, price, 0, "filled"]
        return fills

    def _unlink(self, order_id: str, order: list) -> None:
        queue = self.levels[order[0]][order[1]]
        queue.remove(order_id)
        if not queue:
            del self.levels[order[0]][order[1]]

    @locked
    def cancel(self, id: str) -> int:
        order = self._open(id)
        self._unlink(id, order)
        left = order[2]
        order[2] = 0
        order[3] = "cancelled"
        return left

    @locked
    def remaining(self, id: str) -> int | None:
        order = self.orders.get(id)
        if order is None or order[3] != "open":
            return None
        return order[2]

    @locked
    def best(self, side: str) -> int | None:
        self._side(side)
        prices = self.levels[side]
        if not prices:
            return None
        return max(prices) if side == "buy" else min(prices)

    @locked
    def depth(self, side: str, levels: int) -> list[int]:
        self._side(side)
        if levels < 0:
            raise ValueError("negative levels")
        prices = sorted(self.levels[side], reverse=side == "buy")[:levels]
        out: list[int] = []
        for p in prices:
            out.append(p)
            out.append(sum(self.orders[i][2] for i in self.levels[side][p]))
        return out

    @locked
    def modify(self, id: str, qty: int) -> None:
        order = self._open(id)
        if qty < 1 or qty > MAX:
            raise ValueError("quantity out of range")
        if qty > order[2]:
            # Growing an order costs its place in the queue.
            queue = self.levels[order[0]][order[1]]
            queue.remove(id)
            queue.append(id)
        order[2] = qty

    @locked
    def traded(self) -> int:
        return self.matched
