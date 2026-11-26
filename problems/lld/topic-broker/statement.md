# Topic broker

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Services publish messages to topics, and consumer groups read them. Every group subscribed
to a topic gets each message, and the consumers inside a group share the group's messages,
so each is handed to one of them at a time. Delivery is at least once: a consumer
acknowledges what it handled (ack) or hands a message back (nack) to be delivered again,
and a message nacked too often goes to the group's dead-letter list.

- `Broker()`: no topics, no groups.
- `publishMsg(topic, payload)`: appends the message to the topic and returns its offset:
  0 for a topic's first message, then 1, 2 and so on.
- `subscribeGroup(group, topic, consumer)`: adds `consumer` to `group` (again is a no-op).
  A new group reads `topic` from the first message published after this call: earlier
  ones aren't its messages. A group reads one topic only, so naming another topic for an
  existing group fails.
- `poll(group, consumer, max)`: hands `consumer` up to `max` of the group's messages that
  are ready, lowest offset first, as `"<offset>:<payload>"`, and makes them in flight. A
  message is ready when it has never been handed out in this group or was nacked since. A
  `consumer` that isn't in the group, or `max` outside 1 to 100, fails.
- `ack(group, offset)`: the in-flight message at `offset` is done for good in this group:
  returns `true`. Returns `false`, changing nothing, when the group has no in-flight message
  at `offset` (never handed out, done, dead, or no such message).
- `nack(group, offset)`: the in-flight message at `offset` is handed back and returns
  `true`. Its third nack in this group sends it to the dead-letter list, never to be
  delivered again; before that it's ready again. Returns `false` like `ack`.
- `deadLetters(group)`: the group's dead messages as `"<offset>:<payload>"`, in the order
  they died.

Groups are independent: what one group does to a message never affects another's. Names
and payloads are printable ASCII and case-sensitive, and an empty one fails; any
call naming a group that doesn't exist (other than `subscribeGroup`) fails, and so does an
`offset` below 0. A call that fails changes nothing. There are at most 10^4 calls.

For example, after `subscribeGroup("billing", "orders", "w1")`, `publishMsg("orders", "o-1")`
returns 0, `poll("billing", "w1", 10)` returns `["0:o-1"]`, `nack("billing", 0)` returns
`true`, and the next poll returns `["0:o-1"]` again.
