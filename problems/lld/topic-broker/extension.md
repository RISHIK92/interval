# Topic broker: replay (extension round)

> PROVISIONAL (LLD practice batch 8d, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A bug in the billing consumer mishandled every message since this morning. Once it's
fixed, the group needs to read them again.

- `replayFrom(group, offset)`: rewinds the group. Every message of its topic at `offset` or
  later that the group has handed out and that's in flight or done becomes ready again,
  with its nack count back to 0. Messages published before the group existed, from
  `offset` on, become the group's messages too, ready. Dead messages stay dead and keep
  their place in the dead-letter list; ready ones stay ready.
- It returns how many messages became ready (not counting ones that already were). An
  `offset` past the topic's last message makes nothing ready. A group that doesn't exist,
  or an `offset` below 0, fails.
- A message that's already ready keeps its nack count.
- An in-flight message that's rewound is no longer in flight, so an `ack` or `nack` of it
  returns `false` until it's handed out again.
