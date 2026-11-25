# Outbox sender: dead letters (extension round)

> PROVISIONAL (LLD practice batch 5a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A message that never gets through shouldn't be retried forever. After too many failed
attempts it goes to a dead-letter list for a human to look at.

- `maxAttempts(n)`: from now on, when a failed send brings a message's failed attempts to
  `n` or more, the message leaves the outbox and becomes a dead letter. Failed attempts
  count from when the message was enqueued, including those before this call, and nothing
  happens to a message until its next failed attempt. Calling it again sets a new limit.
  An `n` below 1 fails. Until it is called there is no limit.
- `deadLetters()`: the ids of the dead letters, in the order they died (outbox order
  within one flush).
- A dead letter is no longer pending, and its id still counts as enqueued, so enqueuing it
  again is refused.
