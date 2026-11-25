# API gateway: rewrites (extension round)

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The users service moved to `/v2/users`, but old clients still call `/users`. The gateway
rewrites their paths so nobody else has to know.

- `rewrite(prefix, replacement)`: requests whose path matches `prefix` (with the base
  round's matching rules) have that prefix replaced by `replacement` before anything else
  happens: `/users/7` becomes `/v2/users/7`. Defining a rewrite for the same prefix again
  replaces it.
  - Both must be prefixes, and neither may be `/`, or it fails.
  - A request is rewritten at most once, by the rewrite with the longest matching prefix;
    the rewritten path isn't rewritten again.
  - Routing, auth and caching then use the rewritten path, so `/users/7` and
    `/v2/users/7` share a cache entry.
