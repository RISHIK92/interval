# SLO burn alerts: unwatching (extension round)

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A team hands a service over and no longer wants its alerts.

- `unwatch(subscriber, service)`: the subscriber stops watching the service and is told
  nothing about it from now on. Returns true, or false (changing nothing) when it wasn't
  watching it. An empty subscriber or service fails.
  - Watching it again later starts afresh: not burning, and last in the order.
