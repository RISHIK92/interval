# Deploy gate: waivers (extension round)

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Sometimes a required check is known to be broken and the team ships anyway, on the record.

- `waive(check, reason)`: the check no longer blocks, whatever it reports from now on, and
  `reason` is kept. Waiving a waived check replaces its reason. A check that isn't
  required fails, and so does an empty check or reason. A waiver is never lifted.
- `waivers()`: every waiver as `<check>: <reason>`, sorted by check name in ascending
  order by character code (the check, not the whole line). Reasons are printable ASCII.
