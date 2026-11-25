> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If `deliver` decided whether a route matches with one if-chain over the pattern's shape, what would you have to edit to add a fourth kind of pattern?

## Approach

Give every kind of pattern its own small matcher with one question, "does this event match?", and its own recogniser that says whether a pattern string is of its kind. Turning a pattern into a matcher tries the recognisers in turn and fails when none claims it, so a new kind is one more matcher and one more entry. Parse each pattern once, when its route is added, and keep the routes in a list in the order they came. Delivering walks that list once, adding a route's handler when its matcher says yes and the handler isn't listed yet, which gives the earliest-matching-route order for free.

## Code sketch

```text
interface Matcher
  matches(event) -> bool

class Exact / Prefix / Anything implements Matcher

KINDS: list of (pattern -> optional<Matcher>)
matcher(pattern) -> Matcher
  // TODO: the first kind that recognises it, else fail

class WebhookRouter
  routes: list of (pattern, handler, matcher)

  route(pattern, handler)
    // TODO: fail on empty names or a bad pattern
    // TODO: skip a route already there; else append
  deliver(event) -> list
    // TODO: fail on "" or an event with "*"
    // TODO: walk the routes; collect unseen handlers that match
  unroute(handler) -> int
    // TODO: drop the handler's routes; return how many
```
