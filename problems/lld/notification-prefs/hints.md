> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which object should own "is 3 o'clock inside 22 to 7?", given that it has nothing to do with channels, urgency or delivery?

## Approach

Split the problem along its concerns. A quiet-hours value object holds a start and end and answers only `contains(hour)`, including the wrap past midnight (start greater than end) and the empty window (start equal to end, which the plain range check already gives you). A per-user preferences object holds the opted-out channels and the quiet window. `route` is then a short decision in a fixed order: opted out means no, urgent means yes, otherwise deliver unless the window contains the hour. Validation of users, channels and hours sits in small helpers called first, so a bad call fails before anything is created or changed.

## Code sketch

```text
class QuietHours(start, end)
  contains(hour) -> bool
    // TODO: start <= end: start <= hour < end
    // TODO: otherwise it wraps: hour >= start or hour < end

class Preferences
  optedOut: set of channel
  quiet: QuietHours or none

class NotificationPrefs
  users: map user -> Preferences

  optOut(user, channel)        // TODO: validate; add to optedOut
  quietHours(user, s, e)       // TODO: validate hours; replace window
  route(user, channel, hour, urgent) -> bool
    // TODO: validate everything first
    // TODO: opted out -> false; urgent -> true
    // TODO: otherwise not quiet at hour
  channels(user) -> list       // TODO: email, push, sms minus opted out
```
