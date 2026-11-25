> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which checks can only be made once the whole request is known, so that they belong in `build` rather than in the setters?

## Approach

Let the builder collect raw parts as they arrive: a map of normalised header names to values, a list of already-encoded query pairs, and an optional body. Each setter validates and normalises its own input straight away, so bad input fails at the call that gave it. `build` is the one place for whole-request rules: it checks the method against the body, adds the derived header, assembles the lines and stores them as a finished, read-only request. Every setter first checks whether that stored request exists, and `build` returns it again instead of rebuilding.

## Code sketch

```text
class RequestBuilder
  method, url
  headers: map name -> value
  pairs: list of "k=v"
  text: optional body
  built: optional list    // set once, never changed

  constructor(method, url)
    // TODO: fail on an unknown method or a bad url
  ensureOpen()
    // TODO: fail if built
  header(name, value)
    // TODO: normalise the name, trim the value, refuse Content-Length
  query(key, value)
    // TODO: percent-encode both; append
  body(text)
  build() -> list
    // TODO: if built, return it
    // TODO: fail on GET/HEAD with a body
    // TODO: request line, sorted headers + length, "", body
```
