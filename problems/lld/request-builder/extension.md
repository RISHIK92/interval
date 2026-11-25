# HTTP request builder: bearer tokens (extension round)

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Most calls authenticate with a bearer token, and a request with two credentials is a bug
the builder should catch.

- `bearer(token)`: sets the `Authorization` header to `Bearer <token>` and returns true.
  When the request already has an `Authorization` header (set by `header` or by an
  earlier `bearer`), it is refused: it returns false and changes nothing.
- An empty token, or one containing a space, fails, and so does `bearer` on a builder that
  has been built. Failing comes before refusing.
- `header("Authorization", ...)` still works as before: it replaces whatever
  `Authorization` header the request has.
