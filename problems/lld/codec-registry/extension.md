# Codec registry: a fallback type (extension round)

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some clients send headers no codec satisfies, and the product would rather answer them in
a default format than refuse.

- `fallbackType(contentType)`: from now on, `negotiate` returns `contentType` whenever it
  would have returned null. A later call replaces the earlier fallback. A content type
  that isn't registered fails.
- A header that's malformed still fails, and a header that some registered type fits
  still picks that type as before.

For example, after `fallbackType("application/json")`, `negotiate("image/png")` returns
`"application/json"`.
