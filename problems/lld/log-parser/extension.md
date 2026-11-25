# Log line parser: detecting the format (extension round)

> PROVISIONAL (LLD practice batch A2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Lines now arrive from many services without saying which format they're in.

- `detect(line)`: the name of the first format, in the order the formats were added, that
  parses the line without it being malformed; null when no format does (or there are no
  formats).
- Detecting is only a check: it never changes what `parsed` returns.
