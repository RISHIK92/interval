> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If one method both split the line and updated the counts, where would the code for a new report go?

## Approach

Split the work into three units that only meet through a small request record (path, status, latency). A parser turns a line into a request or nothing, and is the only code that knows the format, including dropping the query string. An aggregate keeps running totals: the number of requests, the number of 5xx responses, and each path's list of latencies, whose length is the path's count. Reports only read the aggregate: the top paths sort by count and then path, the error rate divides the two totals, and the median sorts one path's latencies and picks the lower middle. The class itself just checks its arguments and wires the three together.

## Code sketch

```text
record Request(path, status, latency)

parse(line) -> optional<Request>
  // TODO: four fields; method in the set; path starts with "/"
  // TODO: status: 3 digits, 100..599; latency: 1..5 digits, <= 60000
  // TODO: drop the query string from the path

class Totals
  requests, errors, latencies: map path -> list
  add(request)  // TODO: count it, a 5xx as an error too

topPaths(totals, n) / errorRate(totals) / median(totals, path)
  // TODO: read the totals only

class AccessStats
  ingest(line) -> bool   // TODO: fail on "", parse, add
  topPaths(n)            // TODO: fail outside 1..100
  errorRate()
  p50(path)              // TODO: fail on a path with no requests
```
