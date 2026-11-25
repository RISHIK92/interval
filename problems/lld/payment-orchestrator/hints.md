> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which of this service's jobs (choosing the order, working out a fee, remembering keys, keeping the books) would you have to touch to add a fourth provider kind?

## Approach

Give each concern its own small unit and let the orchestrator only wire them together. Fee rules share one interface ("a fee for this amount at this rate"), one per kind, looked up from the kind when a provider is added; nothing else knows the kinds. A provider object knows its fee rule and its count of failures to come, and answers one question per attempt. A ledger keeps each provider's settled amount and each captured charge's provider and refundable remainder. A map from key to outcome makes charging idempotent: check every argument first, then answer a known key from the map; otherwise walk the providers until one attempt succeeds, record the capture, and store the outcome either way.

## Code sketch

```text
interface FeeRule
  fee(cents, bps) -> int
class CardFee / WalletFee / BankFee implements FeeRule

class Provider(name, rule, bps)
  failures
  attempt() -> bool    // TODO: use up a failure, or succeed
class Ledger
  settled: map provider -> int
  captures: map key -> (provider, refundable)
  capture(key, provider, cents) / refund(key, cents) -> bool

class PaymentOrchestrator
  providers, outcomes: map key -> string, ledger
  provider(name, kind, feeBps) / failProvider(name, times)
  charge(key, customer, cents, providers) -> string
    // TODO: check every argument and provider
    // TODO: a known key returns its outcome
    // TODO: first provider whose attempt succeeds captures
    // TODO: store "captured:<p>" or "failed"
  refund(key, cents) -> bool   // TODO: fail on an unknown key
  settled(provider) -> int
```
