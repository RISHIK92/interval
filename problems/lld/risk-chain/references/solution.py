from __future__ import annotations

from abc import ABC, abstractmethod
from collections import deque

WINDOW_MS = 60_000
VERDICTS = ("allow", "review", "block")


class Payment:
    def __init__(self, customer: str, cents: int, country: str, now_ms: int) -> None:
        self.customer = customer
        self.cents = cents
        self.country = country
        self.now_ms = now_ms


class History:
    """What the checks may look at besides the payment: shared by the whole chain."""

    def __init__(self) -> None:
        self.blocked: set[str] = set()
        self.home: dict[str, str] = {}
        self.recent: dict[str, deque[int]] = {}

    def remember(self, p: Payment) -> None:
        self.home.setdefault(p.customer, p.country)
        times = self.recent.setdefault(p.customer, deque())
        times.append(p.now_ms)
        # Times never decrease, so the ones that left the window are at the front.
        for _ in range(len(times)):
            if times[0] > p.now_ms - WINDOW_MS:
                break
            times.popleft()


class Check(ABC):
    """One link: it decides the payment or returns None to pass it to the next link."""

    kind = ""

    def __init__(self, param: int) -> None:
        self.param = param

    @abstractmethod
    def decide(self, p: Payment, history: History) -> str | None: ...


class Blocklist(Check):
    kind = "blocklist"

    def decide(self, p: Payment, history: History) -> str | None:
        return "block" if p.customer in history.blocked else None


class Velocity(Check):
    kind = "velocity"

    def decide(self, p: Payment, history: History) -> str | None:
        return "review" if len(history.recent[p.customer]) > self.param else None


class AmountLimit(Check):
    kind = "amount"

    def decide(self, p: Payment, history: History) -> str | None:
        return "block" if p.cents > self.param else None


class CountryMismatch(Check):
    kind = "country"

    def decide(self, p: Payment, history: History) -> str | None:
        return "review" if history.home[p.customer] != p.country else None


# Each kind with the least param it accepts; blocklist and country take none, so only 0.
KINDS: dict[str, tuple[type[Check], int, bool]] = {
    "blocklist": (Blocklist, 0, False),
    "velocity": (Velocity, 1, True),
    "amount": (AmountLimit, 0, True),
    "country": (CountryMismatch, 0, False),
}


class RiskChain:
    def __init__(self) -> None:
        self._checks: list[Check] = []
        self._history = History()
        self._counts = dict.fromkeys(VERDICTS, 0)
        self._skips: set[tuple[str, str]] = set()

    def addCheck(self, check: str, param: int) -> None:
        if check not in KINDS:
            raise ValueError("unknown check")
        make, low, takes = KINDS[check]
        if param < low or (param != low and not takes):
            raise ValueError("param out of range")
        self._checks.append(make(param))

    def block(self, customer: str) -> None:
        if customer == "":
            raise ValueError("empty customer")
        self._history.blocked.add(customer)

    def assess(self, customer: str, cents: int, country: str, nowMs: int) -> str:
        if customer == "" or country == "" or cents < 1:
            raise ValueError("bad payment")
        p = Payment(customer, cents, country, nowMs)
        self._history.remember(p)
        verdict = "allow"
        for check in self._checks:
            if (customer, check.kind) in self._skips:
                continue
            decided = check.decide(p, self._history)
            if decided is not None:
                verdict = decided
                break
        self._counts[verdict] += 1
        return verdict

    def decisions(self, verdict: str) -> int:
        if verdict not in self._counts:
            raise ValueError("unknown verdict")
        return self._counts[verdict]

    # The extension round: trusted customers skip a kind of check.
    def skipFor(self, customer: str, check: str) -> bool:
        if customer == "" or check not in KINDS:
            raise ValueError("bad skip")
        if (customer, check) in self._skips:
            return False
        self._skips.add((customer, check))
        return True
