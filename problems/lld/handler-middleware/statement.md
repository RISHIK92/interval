# Handler middleware

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A request handler gets wrapped in layers of middleware, each adding one concern without the
handler knowing. A request goes in through every layer, outermost first, reaches the
handler, and its response comes back out through the same layers in reverse. Build the
stack, and have each request return the trace of what happened on the way.

The last layer wrapped is the outermost. Each layer writes a line when the request enters
it and another when the response leaves it:

| Layer        | Entering                                                                     | Leaving                                                                                   |
| ------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `auth`       | `"enter auth"`                                                               | `"leave auth"`                                                                            |
| `request-id` | `"enter request-id <n>"`, `<n>` counting the requests this layer has entered | `"leave request-id"`                                                                      |
| `compress`   | `"enter compress"`                                                           | `"leave compress gzip"` when the response status is 200, and `"leave compress"` otherwise |

The handler writes `"<handler> <path>"` and responds with status 200. `auth` lets a request
in only when its token is `"Bearer "` followed by at least one character (case matters).
Otherwise it short-circuits: it writes `"deny"` between its own two lines and responds with
status 401 itself, so nothing inside it runs. Layers outside it still write both lines.

- `HandlerStack(handler)`: the handler with no layers. An empty name fails.
- `wrap(layer)`: wraps the stack in a new layer from the table, outermost. The same layer
  may be wrapped more than once, and each is its own layer with its own count. Any other
  name fails (case matters).
- `handle(path, token)`: sends a request through the stack and returns its trace: every
  line in the order written, then the response status as a string (`"200"` or `"401"`).
  An empty path or token fails.
- `layers()`: the layers' names, outermost first.

A call that fails changes nothing. Names, paths and tokens are printable ASCII, a stack has
at most 50 layers, and there are at most 10^4 calls.

For example, `HandlerStack("users")` wrapped in `compress`, then `auth`, then `request-id`
gives `layers()` `["request-id", "auth", "compress"]`, and `handle("/me", "guest")` returns
`["enter request-id 1", "enter auth", "deny", "leave auth", "leave request-id", "401"]`.
