# Notification bridge: push notifications (extension round)

> PROVISIONAL (LLD practice batch 7b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Mobile wants push notifications, and every kind of message should work there from day one.

- `addPush()`: adds a fourth channel, `"push"`, and returns true. If it has already been
  added, it's refused: false.

| Channel  | Heading of `t` | Line break | Default limit |
| -------- | -------------- | ---------- | ------------- |
| `"push"` | `t`            | `-`        | 100           |

(Push's line break is a space, a hyphen and a space.)

- Once added, `"push"` works with every kind and in every call that takes a channel, under
  the same rules as the other three: the same layouts, cutting and receipt rule, its own
  sent count starting at 0, and `channelLimit` with the same bounds.
- Before `addPush()`, `"push"` is an unknown channel, as it always was.
