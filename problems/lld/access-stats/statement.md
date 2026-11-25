# Access log stats

> PROVISIONAL (LLD practice batch D2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a small access-log analyser. It has three jobs, and each is its own unit: **parsing**
a line into a request, **aggregating** the requests, and **reporting** from the aggregates.

A line is four fields separated by single spaces: `METHOD PATH STATUS LATENCY`, for example
`"GET /api/users?page=2 200 35"`. A line parses only when all of these hold:

- there are exactly four fields (so a doubled, leading or trailing space refuses the line);
- `METHOD` is one of `GET`, `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE` (case matters);
- `PATH` starts with `/`; everything from its first `?` on (the query string) is dropped,
  so `/api/users?page=2` counts as `/api/users`;
- `STATUS` is exactly three decimal digits, from 100 to 599;
- `LATENCY`, in milliseconds, is 1 to 5 decimal digits, from 0 to 60000 (`"00007"` is 7).

The methods:

- `AccessStats()`: starts with no requests.
- `ingest(line)`: parses the line and, when it parses, counts the request and returns true.
  A line that doesn't parse returns false and changes nothing. An empty line fails.
- `topPaths(n)`: the paths with the most requests, at most `n` of them, most requests first;
  paths with equal counts are in ascending order by character code (`"/B"` before `"/a"`).
  `n` outside 1 to 100 fails.
- `errorRate()`: the share of requests whose status is 500 or more, from 0.0 to 1.0; 0.0
  when there are no requests. It's judged to within 10^-9.
- `p50(path)`: the median latency of the path's requests. With an even number of requests,
  it's the lower of the two middle latencies. A path with no requests fails, including an
  empty one and one with a query string (stored paths never have one).

Lines and paths are printable ASCII and case-sensitive, lines are at most 200 characters, and
there are at most 10^4 calls.

For example, after `"GET /a 200 10"`, `"GET /a?x=1 503 30"` and `"POST /b 201 20"`,
`topPaths(5)` is `["/a", "/b"]`, `errorRate()` is about 0.333 and `p50("/a")` is 10.
