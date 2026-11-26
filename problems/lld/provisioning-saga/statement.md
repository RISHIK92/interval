# Account provisioning saga

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Creating an account touches four systems, and no transaction spans them. A saga runs the
four steps in order: `create-user`, `create-repo`, `grant-access`, `send-welcome`. When a
step fails, the saga compensates: it undoes the steps it has done, newest first, so no
account is left half-made. A later retry carries on where the saga stopped, and never does
a step that's already done. The step services are fakes whose failures you script.

- `ProvisioningSaga()`: no sagas, and no step fails.
- `failStep(step, times)`: the step's next `times` attempts fail, whichever accounts they
  are for. This replaces any count the step had left, so 0 makes it healthy again. A step
  that isn't one of the four (case matters) or `times` outside 0 to 1000 fails.
- `start(account)`: starts the account's saga and returns its status. If the account
  already has a saga, it returns that saga's status and runs nothing, so a repeated start is
  safe.
- `retry(account)`: runs the account's saga again and returns its status. A `"completed"`
  saga runs nothing.
- `trail(account)`: everything the account's saga has done, oldest first, across all its
  runs.
- `status(account)`: the saga's status, `"completed"` or `"compensated"`.

A run goes through the four steps in order, skipping each step that's done (done and not
undone since):

1. Each attempt of a step either fails, using up one of its scripted failures and adding
   `"fail:<step>"` to the trail, or succeeds, adding `"do:<step>"`; the step is then done.
2. When all four steps are done, the status is `"completed"`.
3. When a step fails, the run stops. Each done step is undone, newest first, adding
   `"undo:<step>"` and making it not done; undoing never fails. The status is
   `"compensated"`.

So a run after compensation starts again from `create-user`. `retry`, `trail` and `status`
fail for an account that has no saga, and every call fails on an empty account. Account
names are printable ASCII and case-sensitive. There are at most 10^4 calls.

For example, after `failStep("grant-access", 1)`, `start("ann")` returns `"compensated"`
with the trail `["do:create-user", "do:create-repo", "fail:grant-access",
"undo:create-repo", "undo:create-user"]`, and `retry("ann")` then returns `"completed"`.
