# Access log stats: status classes (extension round)

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The on-call dashboard wants a breakdown of responses by status class.

- `byStatusClass()`: a map from status class to the number of requests in it. A status's
  class is its first digit followed by `xx`: 204 is `"2xx"` and 503 is `"5xx"`. Only
  classes with at least one request appear, so with no requests the map is empty. Lines
  that didn't parse never count.

For example, after requests with statuses 200, 204, 404 and 503, `byStatusClass()` is
`{"2xx": 2, "4xx": 1, "5xx": 1}`.
