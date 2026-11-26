# Build status subscribers: pausing (extension round)

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A pager on a maintenance window shouldn't get events, but it mustn't miss them either.

- `pause(subscriber)`: from now on, an event the subscriber chose is kept back instead of
  delivered, and `publish` leaves the subscriber out of the names it returns. A name that
  isn't subscribed, or a subscriber already paused, fails.
- `resume(subscriber)`: delivers everything kept back, in the order it was published, to
  the inbox, and returns how many that was (0 when nothing was kept). Events are delivered
  as usual again from now on. A name that isn't subscribed, or a subscriber that isn't
  paused, fails.
- Unsubscribing a paused subscriber drops what was kept back; subscribing again starts it
  unpaused.
