# Notification bridge

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A platform sends three kinds of message (alerts, digests and receipts) over three channels
(email, chat and SMS). Kinds and channels change for different reasons: product adds a kind,
infrastructure adds a channel. So neither knows the other's details. A kind lays out its
message using only what every channel offers, a heading style, a line break and a length
limit, and any kind can go over any channel.

Each channel offers:

| Channel   | Heading of `t` | Line break     | Default limit |
| --------- | -------------- | -------------- | ------------- |
| `"email"` | `Subject: t`   | a newline `\n` | 2000          |
| `"chat"`  | `*t*`          | a newline `\n` | 500           |
| `"sms"`   | `t`            | `\|`           | 160           |

(SMS's line break is a space, a vertical bar and a space.) Each kind lays out a message from
a subject and a body. Below, `H(t)` is the channel's heading of `t` and `BR` its line break:

| Kind        | Message                                                                                |
| ----------- | -------------------------------------------------------------------------------------- |
| `"alert"`   | `H("ALERT: " + subject)`, `BR`, then the body                                          |
| `"digest"`  | `H("Digest: " + subject)`, then for each item of the body, `BR` and `"- " + item`      |
| `"receipt"` | `H("Receipt: " + subject)`, `BR`, the body, `BR`, then `"Keep this for your records."` |

A digest's items are the parts of the body between semicolons, with leading and trailing
spaces removed; empty items are skipped, so a body of only semicolons and spaces gives a
digest with just its heading.

When a message is longer than the channel's limit, an alert or a digest is cut to its first
`limit - 3` characters followed by `"..."`, so it is exactly `limit` long. A receipt is
never cut: a receipt longer than the limit fails. A message exactly at the limit is sent
whole.

- `Notifier()`: the three channels, with their default limits and nothing sent.
- `send(kind, channel, subject, body)`: returns the message, and counts it as sent on that
  channel. A kind or channel not in the tables (case matters), or an empty subject or body,
  fails.
- `sent(channel)`: how many messages that channel has sent. An unknown channel fails.
- `channelLimit(channel, maxChars)`: sets that channel's limit for every later message. An
  unknown channel, or a `maxChars` below 10 or above 10000, fails.

A call that fails changes nothing and sends nothing. Subjects and bodies are printable
ASCII (no newlines), at most 10,000 characters, and there are at most 10^4 calls.

For example, `send("alert", "sms", "db-1 down", "Primary is not answering.")` returns
`"ALERT: db-1 down | Primary is not answering."`, and
`send("digest", "chat", "Monday", "3 deploys; 1 incident ;; 0 pages")` returns
`"*Digest: Monday*\n- 3 deploys\n- 1 incident\n- 0 pages"`.
