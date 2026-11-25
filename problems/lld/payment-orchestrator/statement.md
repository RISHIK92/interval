# Payment orchestration

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the service that takes a payment through one of several payment providers. Several
concerns meet here, and each deserves its own home: which provider to try, what each kind
of provider charges, whether a request was already handled, and what each provider owes
the merchant.

**Providers.** Each provider has a kind, and each kind works out its fee its own way from
the charge's `cents` and the provider's `feeBps` (basis points: 100 is 1%). Divisions round
down to a whole cent.

| Kind       | Fee                                         |
| ---------- | ------------------------------------------- |
| `"card"`   | `cents × feeBps ÷ 10000`, plus 30 cents     |
| `"wallet"` | `cents × feeBps ÷ 10000`                    |
| `"bank"`   | `cents × feeBps ÷ 10000`, at most 500 cents |

- `PaymentOrchestrator()`: starts with no providers.
- `provider(name, kind, feeBps)`: adds a provider. A kind not in the table (case matters), a
  name that's taken, or `feeBps` outside 0 to 1000 fails.
- `failProvider(name, times)`: the provider's next `times` attempts fail; this replaces any
  count it had left, so 0 makes it healthy again. `times` outside 0 to 1000 fails.
- `charge(key, customer, cents, providers)`: tries the providers in the order given. An
  attempt on a provider with failures left uses one up and fails, and the charge falls
  back to the next. The first attempt that doesn't fail captures the charge, and the rest
  aren't attempted. It returns `"captured:<provider>"`, or `"failed"` when every attempt
  failed.
  - `key` is an idempotency key. A key that a charge already used returns that charge's
    outcome, `"failed"` included, and attempts nothing, whatever the other arguments are
    (they are still checked first).
  - An empty `providers`, a provider listed twice, or an unknown provider fails.
- `refund(key, cents)`: refunds part of the charge with that key and returns true. A refund
  that would take the charge's refunds past what it captured returns false, and so does any
  refund of a charge that failed. An unknown key fails.
- `settled(provider)`: what the provider owes the merchant: each charge it captured less
  its fee, less every refund of those charges. A fee can be more than the charge (a small
  card charge), and fees aren't returned on a refund, so this can be negative.

An empty name, key or customer fails in every call, and so do `cents` outside 1 to 10^7 and
an unknown provider. A call that fails changes nothing: it uses no failures and doesn't
record its key. Names, keys and customers are printable ASCII and case-sensitive, and there
are at most 10^4 calls.

For example, with `"stripe"` a `"card"` provider at 290 and `"paypal"` a `"wallet"` at 350,
charging 10000 cents on `["stripe", "paypal"]` returns `"captured:stripe"` and settles
10000 − 320 = 9680 to stripe. If stripe then fails once, a 5000-cent charge returns
`"captured:paypal"` and settles 4825 to paypal.
