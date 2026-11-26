# Merged log tail

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Several services each write a log stream in time order. An operator tails them as one
merged stream, oldest first, while new lines keep arriving. Build the iterator.

Lines are merged in order of time, then stream name, and lines of one stream with the
same time stay in the order they were added. The iterator has a **position**: the
(time, stream) of the line it last returned, or of the last skip that moved it. It
starts before everything.

- `LogMerger()`: no streams, no lines.
- `addLine(stream, ts, line)`: appends a line to the stream (creating it) and returns
  true. Returns false, adding nothing, when `ts` is earlier than the stream's last line,
  or when (`ts`, `stream`) comes before the position, as it would have had to be
  returned already. A line at exactly the position's time and stream is accepted: it
  comes after the one returned.
- `hasNext()`: whether there is a line the iterator hasn't returned or skipped.
- `next()`: returns the next line in merged order as `"<ts> <stream> <line>"` and moves
  the position to it. With nothing left it fails.
- `skipUntil(ts)`: skips every line before time `ts` that hasn't been returned or
  skipped, and returns how many it skipped. The position moves to (`ts`, before any
  stream), so the next line returned is the first at `ts` or later. When the position is
  already there or beyond, it skips nothing and stays.

An empty stream or line, or a negative time, fails, in every call, and a call that fails
changes nothing. Stream names and lines are printable ASCII and case-sensitive, and stream
names are compared by character code. Times are at most 10^12, there are at most 100
streams, and there are at most 10^4 calls.

For example, after `addLine("web", 10, "GET /")` and `addLine("db", 12, "slow query")`,
`addLine("web", 12, "GET /a")` returns true and `addLine("db", 5, "boot")` returns false.
`next()` then returns `"10 web GET /"`, then `"12 db slow query"`, then `"12 web GET /a"`,
and after that `addLine("db", 11, "late")` returns false.
