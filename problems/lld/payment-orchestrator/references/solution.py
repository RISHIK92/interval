from __future__ import annotations

from abc import ABC, abstractmethod

MAX_CENTS = 10**7
MAX_FEE_BPS = 1_000
MAX_FAILURES = 1_000
CARD_FIXED_CENTS = 30
BANK_CAP_CENTS = 500
FAILED = "failed"


# Each kind's fee is its own rule behind one contract: given an amount and a rate in basis
# points, a fee in whole cents. A new kind is a new rule; nothing that charges changes.
class FeeRule(ABC):
    @abstractmethod
    def fee(self, cents: int, bps: int) -> int: ...


class CardFee(FeeRule):
    def fee(self, cents: int, bps: int) -> int:
        return cents * bps // 10_000 + CARD_FIXED_CENTS


class WalletFee(FeeRule):
    def fee(self, cents: int, bps: int) -> int:
        return cents * bps // 10_000


class BankFee(FeeRule):
    def fee(self, cents: int, bps: int) -> int:
        return min(cents * bps // 10_000, BANK_CAP_CENTS)


FEES: dict[str, FeeRule] = {"card": CardFee(), "wallet": WalletFee(), "bank": BankFee()}


# A provider as the orchestrator sees it: something that may fail an attempt, and a fee.
class Provider:
    def __init__(self, name: str, rule: FeeRule, bps: int) -> None:
        self.name = name
        self._rule = rule
        self._bps = bps
        self.failures = 0

    def attempt(self) -> bool:
        failed = self.failures != 0
        if failed:
            self.failures -= 1
        return not failed

    def fee(self, cents: int) -> int:
        return self._rule.fee(cents, self._bps)


# Settlement: what each provider owes the merchant, and what each charge can still refund.
class Ledger:
    def __init__(self) -> None:
        self.settled: dict[str, int] = {}
        self._captures: dict[str, tuple[str, int]] = {}

    def open(self, provider: str) -> None:
        self.settled[provider] = 0

    def capture(self, key: str, provider: Provider, cents: int) -> None:
        self._captures[key] = (provider.name, cents)
        self.settled[provider.name] += cents - provider.fee(cents)

    def refund(self, key: str, cents: int) -> bool:
        if key not in self._captures:
            return False
        provider, left = self._captures[key]
        if cents > left:
            return False
        self._captures[key] = (provider, left - cents)
        self.settled[provider] -= cents
        return True


# Routing: the order a charge tries providers in.
class Router:
    def __init__(self) -> None:
        self._rule: tuple[int, str] | None = None

    def order(self, providers: list[str], cents: int) -> list[str]:
        if self._rule is None or cents < self._rule[0]:
            return providers
        first = self._rule[1]
        return [first, *[p for p in providers if p != first]]

    def prefer(self, threshold: int, provider: str) -> None:
        self._rule = (threshold, provider)


def _named(text: str) -> str:
    if text == "":
        raise ValueError("an empty name")
    return text


def _cents(cents: int) -> int:
    if not 1 <= cents <= MAX_CENTS:
        raise ValueError("cents are 1 to 10^7")
    return cents


class PaymentOrchestrator:
    def __init__(self) -> None:
        self._providers: dict[str, Provider] = {}
        self._outcomes: dict[str, str] = {}
        self._ledger = Ledger()
        self._router = Router()

    def provider(self, name: str, kind: str, feeBps: int) -> None:
        if _named(name) in self._providers or kind not in FEES:
            raise ValueError("a new provider of a known kind")
        if not 0 <= feeBps <= MAX_FEE_BPS:
            raise ValueError("a fee is 0 to 1000 basis points")
        self._providers[name] = Provider(name, FEES[kind], feeBps)
        self._ledger.open(name)

    def failProvider(self, name: str, times: int) -> None:
        if not 0 <= times <= MAX_FAILURES:
            raise ValueError("times is 0 to 1000")
        self._known(name).failures = times

    def charge(self, key: str, customer: str, cents: int, providers: list[str]) -> str:
        _named(key)
        _named(customer)
        _cents(cents)
        if providers == [] or len(set(providers)) != len(providers):
            raise ValueError("one or more distinct providers")
        tried = [self._known(p) for p in self._router.order(providers, cents)]
        if key in self._outcomes:
            return self._outcomes[key]
        outcome = FAILED
        for provider in tried:
            if provider.attempt():
                self._ledger.capture(key, provider, cents)
                outcome = f"captured:{provider.name}"
                break
        self._outcomes[key] = outcome
        return outcome

    def refund(self, key: str, cents: int) -> bool:
        if _named(key) not in self._outcomes:
            raise KeyError("an unknown key")
        return self._ledger.refund(key, _cents(cents))

    def settled(self, provider: str) -> int:
        return self._ledger.settled[self._known(provider).name]

    # The extension round.
    def routeByAmount(self, thresholdCents: int, provider: str) -> None:
        self._router.prefer(_cents(thresholdCents), self._known(provider).name)

    def _known(self, name: str) -> Provider:
        if name not in self._providers:
            raise KeyError("an unknown provider")
        return self._providers[name]
