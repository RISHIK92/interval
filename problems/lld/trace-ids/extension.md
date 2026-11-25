# Trace ID source: decoding (extension round)

> PROVISIONAL (LLD practice batch 6b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

The log viewer wants to show when and where a request started, given only its trace ID.

- `decode(traceId)`: the three parts of an ID as numbers: `[timestamp, node, sequence]`.
  It decodes any well-formed ID, whichever node or source issued it, and changes nothing.
  - A well-formed ID is exactly 13 digits, a `-`, 4 digits, a `-` and 3 digits, where a
    digit is `0` to `9`, and its node is at most 1023. Anything else fails.

For example, `decode("0000000001000-0007-001")` returns `[1000, 7, 1]`.
