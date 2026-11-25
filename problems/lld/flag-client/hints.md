> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When `evaluate` runs, which two sources of truth could answer, and in what order should it ask them?

## Approach

Keep three things apart behind the one `evaluate` call. The simulated server holds, per flag, its parsed rules and version, and ignores a publish that isn't newer. The client's copy is a snapshot of the server's rules taken by a sync that reached it, together with the time of that sync. The defaults never change. Parse each rule string once, when it's published, into a small object with a single `matches(flag, user, attrs)` method (user, attribute, percentage), so evaluating a flag is "any rule matches". `evaluate` then asks the copy first and the defaults second.

## Code sketch

```text
interface Rule
  matches(flag, user, attrs) -> bool
class UserRule, AttrRule, PercentRule   // TODO: parse in the constructor
parseRule(text) -> Rule                 // TODO: kind before the first ":"
bucket(flag, user) -> 0..99             // TODO: the stated hash

class FlagClient
  defaults: map flag -> bool
  server: map flag -> (rules, version)
  copy: map flag -> rules
  syncedAt: time or none

  serverRules(flag, rules, version)     // TODO: parse all, then keep if newer
  sync(nowMs, reachable) -> bool        // TODO: snapshot server, stamp time
  evaluate(flag, user, attrs) -> bool
    // TODO: copy has flag? any rule matches
    // TODO: else default, else fail
  staleMs(nowMs) -> int                 // TODO
```
