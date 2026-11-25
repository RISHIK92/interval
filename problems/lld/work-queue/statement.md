# Bounded work queue

> PROVISIONAL (LLD practice batch A4a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a first-in, first-out queue of work items with a fixed capacity, where every method
states its contract: what it requires (its precondition), what it promises (its
postcondition), and what is always true of the queue (its invariant: it never holds more
than `capacity` items).

- `WorkQueue(capacity)`: an empty queue. Requires `capacity` from 1 to 1000; otherwise the
  constructor fails.
- `offer(item)`: requires a non-empty item, or the call fails. When the queue is full it
  returns false and nothing changes. Otherwise the item goes to the back and it returns
  true.
- `take()`: requires a non-empty queue, or the call fails. Removes and returns the item at
  the front, the oldest one offered.
- `peekNext()`: the item at the front, or null when the queue is empty. It requires
  nothing and never changes anything.
- `size()`: how many items the queue holds.

The same item may be in the queue more than once. A call that fails changes nothing. Items
are printable ASCII, case-sensitive, and the capacity argument is from -10^9 to 10^9.
There are at most 10^4 calls.
