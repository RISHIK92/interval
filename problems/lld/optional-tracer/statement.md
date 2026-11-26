# Optional tracing

> PROVISIONAL (LLD practice batch 8a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Tracing every request costs too much, so only some traces are sampled: one in every
`sampleEvery`. Code that traces must never have to check whether its trace is sampled:
an unsampled trace takes the same calls, never refuses them, and records nothing.

- `Tracer(sampleEvery)`: no traces yet. A rate outside 1 to 1000 fails.
- `startTrace(name)`: starts a trace and returns its id, `"<name>#<n>"`, where `<n>`
  counts the traces started so far, this one included. The 1st trace is sampled, then
  every `sampleEvery`-th one after it: with `sampleEvery` 3, the 1st, 4th, 7th and so on.
  An empty name fails; names may repeat.
- `span(trace, name)`: starts a span in the trace and returns its id. In a sampled trace,
  span ids count the spans started in that trace so far, this one included, from 1, and
  the span is open until it ends. In an unsampled trace it returns 0 and keeps nothing.
- `endSpan(trace, spanId)`: in a sampled trace, ends the open span with that id, records
  it, and returns true; it returns false, changing nothing, when no open span of that
  trace has that id (it never started, or it has already ended). In an unsampled trace it
  returns true, whatever the id.
- `recorded(trace)`: the spans the trace has recorded, in the order they ended, each as
  `"<span id> <span name>"`. Open spans aren't recorded. Always empty for an unsampled
  trace.

The checks are the same for every trace, sampled or not: a trace id that `startTrace`
never returned fails, and so does an empty span name. A call that fails changes nothing.
Names are printable ASCII, case-sensitive and kept exactly as given, spaces and all, and
there are at most 10^4 calls.

For example, with `sampleEvery` 2, three traces named `checkout`, `checkout` and
`search` get the ids `"checkout#1"`, `"checkout#2"` and `"search#3"`, and the first and
third are sampled. In `"checkout#1"`, spans `load cart` and `charge card` get ids 1 and
2, and ending 2 then 1 records `["2 charge card", "1 load cart"]`. In `"checkout#2"`,
`span` returns 0, `endSpan` returns true for any id, and nothing is recorded.
