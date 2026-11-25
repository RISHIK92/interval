# Alert channels

> PROVISIONAL (LLD practice batch A1, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build an alert dispatcher that sends messages through named channels of three kinds. Each
kind formats a message its own way and has its own price per message.

| Kind      | What `send` returns                                                                              | Price per message |
| --------- | ------------------------------------------------------------------------------------------------ | ----------------- |
| `"email"` | `Subject: ` followed by the message                                                              | 1 cent            |
| `"sms"`   | the message when it's at most 20 characters; otherwise its first 17 characters followed by `...` | 5 cents           |
| `"pager"` | the message with every letter in upper case, followed by `!`                                     | 25 cents          |

- `AlertDispatcher()`: starts with no channels.
- `addChannel(name, kind)`: adds a channel. An unknown kind (case matters), an empty name
  or a name already in use, whatever its kind, fails and changes nothing.
- `send(channel, message)`: sends the message through the channel and returns it formatted
  by the channel's kind. An empty message is sent like any other. An unknown channel fails.
- `cost(channel)`: what the channel has cost so far, in cents: its price times the
  messages sent through it. An unknown channel fails.

Messages are printable ASCII.
