# Load balancing strategies: draining (extension round)

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Before a backend is upgraded, it stops taking new connections while its open ones finish.

- `drain(backend)`: the backend is never picked again, by the current strategy or any
  later one. Its open connections stay open and can still be closed with `done`, and its
  name stays taken.
  - Every strategy picks among the backends that aren't drained, as if the drained ones
    weren't there: round robin goes on to the next backend that isn't drained, and
    weighted round robin leaves a drained backend's weight out of the total and its
    current weight as it was.
  - `pick()` fails when every backend is drained.
  - An unknown backend, or one already drained, fails.
