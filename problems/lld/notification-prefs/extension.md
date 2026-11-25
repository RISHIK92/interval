# Notification preferences: digests (extension round)

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Some users would rather get one summary than many messages.

- `digest(user, channel)`: from now on, a non-urgent message routed to that channel for
  that user is held for the user's digest: `route` returns false and the message is
  counted, whatever the hour (quiet hours don't drop it). Urgent messages on the channel
  are routed as before. Asking twice changes nothing.
- An opt-out still wins: a message on a channel the user opted out of is never held, and
  opting out of a channel drops the messages already held for it.
- `flushDigest(user)`: the number of messages held for the user across all channels, which
  are then sent in one digest, so the count starts again from 0.
