> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If callers can only ever reach a key through `can`, `narrow` and `revoke`, which rules does each of those calls have to enforce so the key can never gain a scope?

## Approach

Keep each key as a private record: its grant, its expiry time and a revoked flag, and expose nothing else. Validate scopes in one function shared by every entry point, and treat the grant as a value that is replaced, never edited: `narrow` builds the new grant, checks that each of its scopes is covered by the old grant, and only then swaps it in. Coverage is one small function (an exact match, or the resource's wildcard), used by both `can` and `narrow`, so asking and narrowing can never disagree. A key works when it isn't revoked and the time is before its expiry.

## Code sketch

```text
class Key
  grant: list of scopes
  expires, revoked

valid(scope, wildcardOk)
  // TODO: letters ":" letters, or letters ":*" when wildcardOk
covers(grant, scope) -> bool
  // TODO: scope in grant, or "<resource>:*" in grant

class ApiKeyStore
  keys: map id -> Key

  issue(owner, scopes, nowMs, ttlMs) -> string
    // TODO: validate everything, then store as "key-<count + 1>"
  can(keyId, scope, nowMs) -> bool
    // TODO: valid(scope, false); then known, not revoked,
    // TODO: nowMs < expires, and covers(grant, scope)
  narrow(keyId, scopes) -> bool
    // TODO: validate; false when unknown, revoked or any scope not covered
    // TODO: replace the grant
  revoke(keyId) -> bool
```
