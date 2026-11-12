from __future__ import annotations

import threading


class Bank:
    def __init__(self) -> None:
        self.accounts: dict[str, int] = {}
        # The extension round: frozen accounts send and receive nothing.
        self.frozen: set[str] = set()
        # One lock for the whole ledger: a transfer touches two accounts at once, and a
        # lock per account would need an ordering to avoid deadlock.
        self.lock = threading.Lock()

    def _known(self, account: str) -> None:
        if account not in self.accounts:
            raise KeyError("unknown account")

    def open(self, account: str, balance: int) -> None:
        if balance < 0:
            raise ValueError("negative opening balance")
        with self.lock:
            if account in self.accounts:
                raise ValueError("account exists")
            self.accounts[account] = balance

    def deposit(self, account: str, amount: int) -> int:
        if amount <= 0:
            raise ValueError("amount must be positive")
        with self.lock:
            self._known(account)
            self.accounts[account] += amount
            return self.accounts[account]

    def withdraw(self, account: str, amount: int) -> bool:
        if amount <= 0:
            raise ValueError("amount must be positive")
        with self.lock:
            self._known(account)
            self._unfrozen(account)
            if self.accounts[account] < amount:
                return False
            self.accounts[account] -= amount
            return True

    def transfer(self, source: str, target: str, amount: int) -> bool:
        if amount <= 0:
            raise ValueError("amount must be positive")
        if source == target:
            raise ValueError("a transfer needs two accounts")
        with self.lock:
            self._known(source)
            self._known(target)
            self._unfrozen(source)
            self._unfrozen(target)
            if self.accounts[source] < amount:
                return False
            self.accounts[source] -= amount
            self.accounts[target] += amount
            return True

    def _unfrozen(self, account: str) -> None:
        if account in self.frozen:
            raise ValueError("account frozen")

    def freeze(self, account: str) -> None:
        with self.lock:
            self._known(account)
            self.frozen.add(account)

    def unfreeze(self, account: str) -> None:
        with self.lock:
            self._known(account)
            self.frozen.discard(account)

    def isFrozen(self, account: str) -> bool:
        with self.lock:
            self._known(account)
            return account in self.frozen

    def balance(self, account: str) -> int:
        with self.lock:
            self._known(account)
            return self.accounts[account]

    def total(self) -> int:
        with self.lock:
            return sum(self.accounts.values())
