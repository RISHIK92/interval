# Build status subscribers

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The CI system publishes an event as each build moves along: `"queued"`, `"started"`,
`"passed"` and `"failed"` (case matters). Chat bots, dashboards and pagers subscribe to
the events they care about, and the publisher shouldn't know anything else about them.

- `BuildEvents()`: no subscribers.
- `subscribe(subscriber, events)`: subscribes to the listed events, after everyone already
  subscribed, with an empty inbox. An empty name, an empty list, an event not among the
  four, an event listed twice, or a subscriber already subscribed fails.
- `unsubscribe(subscriber)`: removes the subscriber and its inbox, so it gets nothing
  more, starting with the next publish. Subscribing again later puts it after everyone
  subscribed by then, with an empty inbox. Returns false, changing nothing, for a name
  that isn't subscribed. An empty name fails.
- `publish(event, build)`: delivers the event to every subscriber that chose it: each
  one's inbox gets `"<build> <event>"`. Returns the names of the subscribers it was
  delivered to, in the order they subscribed (empty when nobody chose it). An event not
  among the four, or an empty build, fails.
- `inbox(subscriber)`: everything delivered to the subscriber since it subscribed, oldest
  first. A name that isn't subscribed fails.

A call that fails changes nothing. Names and builds are printable ASCII and
case-sensitive, and are kept exactly as given, spaces and all. There are at most 100
subscribers and at most 10^4 calls.

For example, with `chat` subscribed to `["failed", "passed"]` and then `pager` to
`["failed"]`, `publish("failed", "b1")` returns `["chat", "pager"]`, and `inbox("pager")`
is `["b1 failed"]`. After `unsubscribe("pager")`, `publish("failed", "b2")` returns
`["chat"]`.
