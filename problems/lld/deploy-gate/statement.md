# Deploy gate

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A deploy pipeline asks one question before it ships: "may I deploy?". Callers tell the
gate which checks are required and what each check reported, and the gate answers. They
never read the checks back to decide for themselves.

- `DeployGate()`: nothing is required and nothing has reported.
- `require(check)`: the check is required from now on. Requiring it again changes nothing.
  There is no way to drop a requirement.
- `report(check, passed)`: records the check's latest result, replacing any earlier one.
  A check may report before or without being required: its latest result counts if it is
  required later.
- `mayDeploy()`: true exactly when every required check's latest result is a pass (so
  true when nothing is required).
- `blockers()`: the required checks whose latest result isn't a pass (never reported, or
  last reported a failure), sorted in ascending order by character code (`"B"` before
  `"a"`).

An empty check name fails in every call. A call that fails changes nothing. Check names are
printable ASCII and case-sensitive. There are at most 500 checks and at most 10^4 calls.
