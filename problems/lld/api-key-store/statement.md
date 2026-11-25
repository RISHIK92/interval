# API keys with scopes

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a store of API keys. Each key belongs to an owner, is granted scopes and works for a
limited time. A key can be narrowed but never widened, and a revoked or expired key can do
nothing.

A **scope** is `resource:action`, where the resource and the action are each one or more
lower-case ASCII letters (`repo:read`). A granted scope may also use `*` as its action
(`repo:*`), which covers every action on that resource. A scope written any other way is
malformed. `*` is never a resource.

Keys are named `key-1`, `key-2` and so on, in the order they're issued; a failed call uses
up no name.

- `ApiKeyStore()`: starts with no keys.
- `issue(owner, scopes, nowMs, ttlMs)`: issues a key at time `nowMs` that works for
  `ttlMs` milliseconds, and returns its name. The key is granted `scopes` (duplicates are
  fine). It fails for an empty owner, fewer than 1 or more than 20 scopes, a malformed
  scope, `nowMs` outside 0 to 10^13 or `ttlMs` outside 1 to 10^12.
- `can(keyId, scope, nowMs)`: whether the key may do `scope` at time `nowMs`: true when
  the key exists, isn't revoked, hasn't expired (`nowMs` is before its issue time plus
  its time to live; any earlier time counts, even one before it was issued), and one of
  its granted scopes is `scope` itself or `resource:*` for its resource. The scope asked
  about must be a plain `resource:action`: a malformed one, or one with `*`, fails, even
  for an unknown key. Any `nowMs` is accepted here.
- `narrow(keyId, scopes)`: replaces the key's grant with `scopes`, which must each be
  covered by the current grant: `res:act` by `res:act` or `res:*`, and `res:*` only by
  `res:*`. Returns true when it narrowed; false, changing nothing, when some scope isn't
  covered or the key is unknown or revoked. Expiry isn't checked (no time is given).
  `scopes` follows `issue`'s rules (1 to 20, well formed), or the call fails.
- `revoke(keyId)`: revokes the key for good. True if it existed and wasn't already
  revoked (an expired key can still be revoked), false otherwise.

A failed call changes nothing.
