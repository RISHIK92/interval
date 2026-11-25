> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If the proxy and the real API answered the very same call, where would the role check have to live so that a denied call could never touch the API's counter?

## Approach

Give the real API and the proxy one shared method, `handle(user, action, target)` returning a status. The real API does the work and counts its calls; it knows nothing about roles. The proxy holds the real API privately, a map from user to the set of roles granted, and a fixed table of what each role allows. Its `handle` answers 401 for an unknown user and 403 when no role allows the action, and only otherwise delegates to the real API. `invoke` validates its arguments, asks its own `handle` for the status, appends the audit line and formats the result, so every attempt is logged in one place and the counter is simply the real API's.

## Code sketch

```text
ROLES: map role -> set of actions
interface AdminApi
  handle(user, action, target) -> status

class RealAdminApi implements AdminApi
  calls, suspended, deleted
  handle(...)  // TODO: count; 404 / 409 / 200 by action

class AdminProxy implements AdminApi
  api: RealAdminApi
  roles: map user -> set of roles
  log: list of lines

  grant(user, role)           // TODO: check, then add
  handle(user, action, target)
    // TODO: 401 if no roles; 403 if none allows it
    // TODO: else api.handle(...)
  invoke(user, action, target)
    // TODO: fail on bad arguments
    // TODO: status = handle(...); audit it; format it
  audit() -> list
  realCalls() -> api.calls
```
