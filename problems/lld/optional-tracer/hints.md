> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

What if an unsampled trace were an object with the same methods that simply does nothing?

## Approach

Give traces one interface (span, endSpan, recorded) with two implementations. The recording one counts span ids, keeps open spans in a map from id to name, and appends to a list when one ends. The null one returns 0, true and an empty list and keeps no state at all. The tracer decides which one a trace gets once, when it starts, from a count of traces started, and keeps them in a map by id. Every other call checks its arguments and then hands the call to the trace object, with no branch on whether it's sampled anywhere.

## Code sketch

```text
interface Trace
  span(name) -> int
  endSpan(spanId) -> bool
  recorded() -> list<string>

class RecordingTrace implements Trace
  open: map id -> name; started = 0; ended: list
  // TODO: span counts ids; endSpan records "<id> <name>"

class NoopTrace implements Trace
  // TODO: 0, true, []

class Tracer(sampleEvery)
  traces: map id -> Trace

  startTrace(name) -> string
    // TODO: fail on ""; n = traces started + 1
    // TODO: sampled if (n - 1) % sampleEvery == 0
  span(trace, name) -> int        // TODO: check, then trace.span
  endSpan(trace, spanId) -> bool  // TODO: check, then trace.endSpan
  recorded(trace) -> list<string>
```
