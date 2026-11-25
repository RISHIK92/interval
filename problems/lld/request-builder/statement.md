# HTTP request builder

> PROVISIONAL (LLD practice batch 6a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

An HTTP client assembles each request step by step, then builds it once: the build checks
the request as a whole and freezes it, so nothing can change a request after it has been
built. Callers never format headers, encode query strings or count body bytes by hand.

- `RequestBuilder(method, url)`: a request with no headers, query or body. `method` is one
  of `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` or `OPTIONS`, exactly. `url` is
  `http://` or `https://` followed by at least one character, none of them `?`, `#` or a
  space. Anything else fails.
- `header(name, value)`: sets a header. A name is one or more letters, digits and `-`,
  and anything else fails. It is normalised: its first character and every character
  right after a `-` become upper case, and every other letter lower case (`x-REQUEST-id`
  is `X-Request-Id`). Spaces around `value` are removed, and a value that is empty after
  that fails. Setting a header whose normalised name is already set replaces its value.
  `Content-Length` (in any case) is set automatically, so setting it fails.
- `query(key, value)`: adds `key=value` to the query string, after the pairs added
  before. The same key may be added again. In both key and value, the letters, digits and
  `-._~` stay as they are, and every other character becomes `%` and its character code
  as two upper-case hex digits (a space is `%20`).
- `body(text)`: sets the body, replacing any earlier one.
- `build()`: the request as a list of lines:
  1. the request line, `<method> <url>`, followed by `?` and the pairs joined with `&`
     when there are any;
  2. one `<Name>: <value>` line per header, sorted by name in ascending order by character
     code (`"X"` before `"a"`), including `Content-Length: <number of characters in the
body>` when there is a body;
  3. an empty line;
  4. the body, or an empty string when there is none.

  A `GET` or `HEAD` request with a body fails at `build`, and the builder stays open, so
  later calls behave as if that build hadn't happened. A build that succeeds freezes the
  builder: from then on `header`, `query` and `body` fail, and `build` returns the same
  lines again.

An empty key, value or body fails. A call that fails changes nothing. Every string is
printable ASCII, a body is at most 1000 characters, and there are at most 10^4 calls.
