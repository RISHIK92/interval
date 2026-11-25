> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If adding a channel meant writing one new class, and adding a kind meant writing one new class, what would each have to be allowed to know about the other?

## Approach

Split the design along the two directions things change. A channel is a small object with a heading style, a line break, a limit and a sent counter; it knows nothing about kinds. A kind is built around a channel and lays out its message using only those channel operations, then fits the result to the channel's limit; the default fit cuts and adds an ellipsis, and the receipt overrides it to refuse instead. Sending looks up the kind and the channel, creates the kind around that channel, renders, and counts the send only when rendering succeeded. Three kinds and three channels are six small classes, not nine combinations.

## Code sketch

```text
abstract class Channel
  limit, sent
  heading(text) -> string
  lineBreak() -> string
class Email, Chat, Sms extends Channel

abstract class Message
  channel: Channel
  layout(subject, body) -> string
  fit(text)       // TODO: cut to limit - 3, add "..."
  render(subject, body) -> fit(layout(...))
class Alert, Digest extends Message   // TODO: layouts
class Receipt extends Message         // TODO: fit fails

class Notifier
  channels: map name -> Channel
  send(kind, channel, subject, body)
    // TODO: look both up, fail on bad input
    // TODO: render, then count the send
  sent(channel) -> int
  channelLimit(channel, maxChars)   // TODO: 10..10000
```
