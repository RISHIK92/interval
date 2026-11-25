> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If a fourth kind arrived tomorrow, how many places in your dispatcher would have to change?

## Approach

Give every kind the same small interface, a price and a way to format a message, and one class per kind that fills it in. Each channel also keeps what it has cost so far, and the dispatcher maps a channel's name to its object; `send` has the channel add its price and format the message, without ever asking which kind it is. The only place kinds are named is where `addChannel` turns a kind string into an object, and that's where an unknown kind fails.

## Code sketch

```text
abstract class Channel
  spent = 0
  price() -> int
  format(message) -> string

class EmailChannel, SmsChannel, PagerChannel implement Channel
  // TODO: each its own price and format

class AlertDispatcher
  channels: map name -> Channel

  addChannel(name, kind)
    // TODO: fail on an unknown kind, an empty name or a name in use
    // TODO: create the kind's channel
  send(channel, message) -> string
    // TODO: fail when unknown; add its price to its spent
    // TODO: return its format(message)
  cost(channel) -> int
    // TODO: fail when unknown; return its spent
```
