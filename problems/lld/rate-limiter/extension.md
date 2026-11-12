# Rate limiter: per-client limits (extension round)

> PROVISIONAL (P5-W31-S02c): written during the build; the owner reviews it before launch.

Some clients now get their own limit.

- `setLimit(client, limit)`: from now on, `client` may make `limit` allowed requests per
  window instead of the default (at least 1, or the call fails and changes nothing).
  Requests already in its window still count against the new limit.
- `limitOf(client)`: the client's limit: its own, or the default.
- `remaining` never goes below 0, even when a lowered limit leaves more requests in the
  window than it now allows.
