> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If `flush` built each receipt itself from the transport's name, how many places would change when a fourth transport arrives?

## Approach

Make the outbox depend on one small abstraction: a transport that takes an id and a payload and either returns its receipt or reports a failure. Each concrete transport only knows its own receipt format, and the shared part counts down the failures planned for it. The outbox gets its transport from a table of names, holds that one instance, and replaces the instance on a swap, so planned failures go with the old one. It keeps the waiting messages in order, every id it has accepted, and on a flush tries each waiting message once, keeping the ones that failed in their order.

## Code sketch

```text
abstract class Transport
  failures
  send(id, payload) -> receipt or null
    // TODO: if failures are planned, use one up and fail
  deliver(id, payload) -> string  // each transport's format

class Http / Queue / Email extends Transport

class OutboxSender
  name, transport, waiting, seen

  constructor(name)
    // TODO: build the transport from a table of names
  enqueue(id, payload) -> bool
    // TODO: fail on empty; false if seen; append
  flush() -> list
    // TODO: one send per waiting message, in order
    // TODO: receipts out; failures stay in their place
  failNext(n) / swapTransport(name) / pending()
```
