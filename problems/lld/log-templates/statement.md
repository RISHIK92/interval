# Log template interning

> PROVISIONAL (LLD practice batch 7c, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Most log events share a handful of message patterns, such as `user {} logged in`. Storing
the full text of every event repeats those patterns millions of times. Instead, each
distinct pattern is stored once and shared, each event keeps only its own parameters, and
an event's text is put together only when someone asks for it.

A pattern's placeholders are the two characters `{}`, found from left to right without
overlapping: `{{}}` has one placeholder, between a `{` and a `}`.

- `LogStore()`: no patterns and no events.
- `log(pattern, params)`: records an event and returns its id. Ids are 1, 2, 3, … in the
  order events are recorded. There must be exactly one parameter per placeholder, or it
  fails. The pattern is stored the first time an event uses it.
- `render(eventId)`: the event's text: its pattern with each placeholder replaced by the
  next parameter, in order. Parameters are inserted as they are: a `{}` inside a parameter
  stays `{}`. An id that isn't an event fails.
- `templates()`: how many distinct patterns are stored.
- `byPattern(pattern)`: the ids of the events with exactly this pattern, in increasing
  order; `[]` when there are none.

An empty pattern or an empty parameter fails, in every call. A call that fails changes
nothing: it stores no pattern and uses up no id. Patterns and parameters are printable
ASCII and case-sensitive, with at most 100 characters and at most 10 parameters per event,
and there are at most 10^4 calls.

For example, `log("disk {} at {}%", ["/var", "91"])` returns `1`, and `render(1)` returns
`"disk /var at 91%"`.
