# Instance billing

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the billing meter for a cloud's instances. Each instance has an id, a kind and an
hourly rate in cents, and runs for some hours. Every kind turns its hours into cents its
own way, and one meter totals them all.

| Kind          | What the instance has cost (`h` = the hours it has been billed for, `r` = its hourly rate)     |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `"on-demand"` | `h × r`                                                                                        |
| `"reserved"`  | an upfront fee of `100 × r`, owed from launch, plus `h × r × 60 ÷ 100` rounded down            |
| `"spot"`      | `h × r × 30 ÷ 100` rounded down, where `h` counts only the hours run before it was interrupted |

The rounding is done once, on all the hours run, so the same hours cost the same however
they were split into runs.

- `BillingMeter()`: starts with no instances.
- `launch(id, kind, hourlyCents)`: adds an instance that has run 0 hours. An unknown kind
  (case matters), an empty id, an id already in use (whatever its kind), or `hourlyCents`
  outside 1 to 10^6 fails.
- `run(id, hours)`: the instance runs `hours` more hours. `hours` outside 1 to 10^4 fails,
  and so does an unknown id. A spot instance that has been interrupted still accepts runs;
  they cost nothing.
- `bill(id)`: what the instance has cost so far, in cents, as in the table. An unknown id
  fails.
- `total()`: the sum of every instance's bill; 0 with no instances.
- `interrupt(id)`: the provider takes a spot instance back. Returns true the first time,
  and false when it was already interrupted. What it has cost so far stays billed, and
  any later runs cost nothing. An unknown id, or an instance that isn't spot, fails.

A call that fails changes nothing. No instance runs 10^6 hours or more in all,
and every bill and total stays below 2^53.
