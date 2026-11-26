> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What is the least the publisher needs to know about a subscriber to hand it an event?

## Approach

Make each subscriber an object that holds its chosen events and its inbox and has one update method that takes a delivery. The publisher keeps those objects in a map that remembers insertion order, so delivery order is subscription order and removing then re-adding a name puts it at the back. Publishing checks its arguments first, then walks the subscribers in order and updates each one that chose the event, collecting their names. Unsubscribing just removes the entry, so the next publish can't reach it.

## Code sketch

```text
EVENTS = { "queued", "started", "passed", "failed" }

class Subscriber
  name, events: set, inbox: list
  update(delivery)          // TODO: keep it

class BuildEvents
  subscribers: insertion-ordered map name -> Subscriber

  subscribe(subscriber, events)
    // TODO: fail on "", [], an unknown or repeated event, a taken name
  unsubscribe(subscriber) -> bool
    // TODO: fail on ""; false if not there
  publish(event, build) -> list<string>
    // TODO: check first; then for each subscriber in order
    // TODO:   if it chose the event: update("<build> <event>"), note its name
  inbox(subscriber) -> list<string>
    // TODO: a copy; fail if not subscribed
```
