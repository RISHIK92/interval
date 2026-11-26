# Optional tracing: forced sampling (extension round)

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

When a request turns out to be interesting halfway through (it failed, or it's slow),
the rest of it should be traced even if its trace wasn't sampled.

- `forceSample(trace)`: an unsampled trace becomes sampled from now on, as if it had just
  started sampled: its next span gets id 1, and it records spans that end from now on.
  Spans started before the call stay unrecorded, and ending one (id 0) now returns false,
  as for any id that isn't an open span.
  - Forcing a trace that's already sampled changes nothing.
  - A trace id that `startTrace` never returned fails.
