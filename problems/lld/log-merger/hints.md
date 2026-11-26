> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

If each stream kept its own "next unread line", what would the merged iterator need to remember about where it has got to?

## Approach

Give every stream its own list of lines and a head index pointing at its first line not yet returned. The merged iterator keeps one position, the (time, stream) of the last line it returned. To find the next line, look at each stream's head, after moving the head past anything that sorts before the position, and pick the smallest by time, breaking ties by stream name. New lines are simply appended to their stream: a line that would sort before the position is refused, so the heads never have to move backwards. Skipping is then just counting what lies before the target time and moving the position there.

## Code sketch

```text
class Stream
  name, lines: list of (ts, text), head = 0

class LogMerger
  streams: map name -> Stream
  position = (0, "")            // (time, stream name)

  firstAhead(stream) -> line or none
    // TODO: move head past lines before position
  peek() -> Stream or none
    // TODO: smallest head by (time, name)
  addLine(stream, ts, line) -> bool
    // TODO: refuse ts < stream's last, or (ts, stream) < position
  hasNext() -> bool             // TODO: peek
  next() -> string
    // TODO: take peek's head, advance it, move position
  skipUntil(ts) -> int          // TODO: count, then move position
```
