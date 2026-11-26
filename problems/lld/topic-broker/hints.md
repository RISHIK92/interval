> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Which state belongs to a topic, and which belongs to each group reading it?

## Approach

Let the broker be a mediator: it owns the topics (just a list of payloads each, so an offset is a list index) and the groups, and every call goes through it. A group object owns everything about its own reading: the next offset never handed out, a sorted set of offsets waiting to be delivered again, each handed-out offset's state (in flight, done, dead) and nack count, and its dead-letter list. Polling takes the redeliveries first and then fresh offsets; because redeliveries are always below the fresh ones, the result stays in offset order. Ack and nack only act on in-flight offsets, and a nack either requeues the offset or, at the limit, kills it.

## Code sketch

```text
class Group
  topic, consumers: set, next
  again: sorted set of offsets
  state: map offset -> in-flight | done | dead
  nacks: map offset -> int
  dead: list of offsets
  take(most, end) -> list of offsets   // TODO: redeliveries, then fresh ones
  settle(offset, acked) -> bool        // TODO: only in-flight; ack, requeue or kill

class Broker
  topics: map name -> list of payloads
  groups: map name -> Group

  publishMsg(topic, payload) -> int    // TODO: append, return the index
  subscribeGroup(group, topic, consumer)  // TODO: new group starts at the end
  poll(group, consumer, max) -> list   // TODO: validate, take, format
  ack(group, offset) -> bool           // TODO
  nack(group, offset) -> bool          // TODO
  deadLetters(group) -> list           // TODO
```
