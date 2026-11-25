# Payment orchestration: routing by amount (extension round)

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Finance negotiated a better rate for large payments with one provider, so large charges
should go there first.

- `routeByAmount(thresholdCents, provider)`: from now on, a charge of `thresholdCents` or
  more tries `provider` first, then the providers it was given, in their order, without
  `provider` if it's among them. It falls back as before when `provider` fails. Charges
  below the threshold are tried as given. A later call replaces the earlier rule.
  `thresholdCents` outside 1 to 10^7, or an unknown provider, fails.
- A charge's own `providers` are checked exactly as before. A key that was already used
  still returns its original outcome and attempts nothing.

For example, after `routeByAmount(5000, "ach")`, a 4999-cent charge on `["stripe"]` tries
only stripe, but a 5000-cent one tries ach and then stripe.
