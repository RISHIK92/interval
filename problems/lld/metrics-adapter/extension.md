# Legacy metrics adapter: batches (extension round)

> PROVISIONAL (LLD practice batch 7a, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The agent can now flush its buffer in one go.

- `ingestBatch(lines)`: takes each line in order, exactly as `ingestLegacy` would, and
  returns how many were taken. A line that isn't taken is skipped, and so is an empty
  line: a batch never fails. Lines earlier in the batch count, so a name's kind can be
  set by one line and refuse a later one. An empty list returns 0.
