# Interchangeable job queues: cancelling (extension round)

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Operators need to pull a job before a worker gets it, on every kind of queue alike.

- `cancel(job)`: removes the job from the queue, ready or not, and returns true. It returns
  false when the queue doesn't hold the job: it was never pushed, was already polled, or
  was already cancelled. An empty name fails.

A cancelled job's name stays used: pushing it again fails. Everything in the contract still
holds after a cancel: `size` drops by one, and `peekAt` and `poll` never return the job.
