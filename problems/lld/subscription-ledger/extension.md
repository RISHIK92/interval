# Event-sourced subscriptions: upcasting (extension round)

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The event schema evolves: `upgraded` is becoming `planChanged`. Stored events can't be
rewritten, so old ones are read under the new name, an upcaster, while new ones are
stored under it.

- `upcast(eventName, newName)`: the event currently named `eventName` is named `newName`
  from now on. New events of that kind are stored as `newName`, and stored events named
  `eventName` are read as `newName`, so `events` shows the new name for every one of them
  and replay treats them all the same way.
- Upcasts chain: after `upcast("upgraded", "planChanged")` and
  `upcast("planChanged", "tierSet")`, events stored under either older name read as
  `tierSet`.
- `eventName` must be a current event name, and `newName` a name never used for any event
  before (current or old), made of one or more ASCII letters and digits, or it fails. Commands keep
  their names (`upgrade` still stores the upgrade event).
