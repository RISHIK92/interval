# Webhook event router

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build the router that sends incoming webhook events to handlers. A route pairs a pattern with
a handler, and there are three kinds of pattern:

| Pattern     | Kind      | Matches                                 |
| ----------- | --------- | --------------------------------------- |
| `"push"`    | exact     | only the event `"push"`                 |
| `"issue.*"` | prefix    | every event that starts with `"issue."` |
| `"*"`       | catch-all | every event                             |

So `"issue.*"` matches `"issue.opened"`, `"issue.comment.created"` and even `"issue."`, but
not `"issue"` or `"issues"`. A pattern with no `*` is exact. A prefix pattern is a non-empty
stem with no `*` in it, followed by `.*`. Any other pattern containing `*` (such as `".*"`,
`"a*"`, `"*.a"` or `"a.*.b"`) fails. New kinds of matcher are expected, so keep each kind's
rule to itself.

- `WebhookRouter()`: starts with no routes.
- `route(pattern, handler)`: adds a route. Adding a route the router already has (the same
  pattern string and handler) changes nothing. A handler can have any number of routes.
- `deliver(event)`: the handlers with at least one route whose pattern matches the event,
  each listed once, in the order of each handler's earliest matching route (the order the
  routes still in place were added). An event containing `*` fails.
- `unroute(handler)`: removes every route of the handler and returns how many there were;
  0 when it had none.

An empty pattern, handler or event fails in every call. A call that fails changes nothing.
Patterns, events and handlers are printable ASCII and case-sensitive, and there are at most
10^4 calls.

For example, with the routes `("push", "ci")`, `("*", "log")` and `("deploy.*", "ci")`
added in that order, `deliver("push")` is `["ci", "log"]` but `deliver("deploy.done")` is
`["log", "ci"]`: ci's earliest route that matches `"deploy.done"` came after log's.
