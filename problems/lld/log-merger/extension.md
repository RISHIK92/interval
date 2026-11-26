# Merged log tail: hiding a stream (extension round)

> PROVISIONAL (LLD practice batch 8b, Q-WD-30): drafted by Claude; the owner reviews it before launch.

A chatty stream is drowning everything else out, and the operator wants to mute it for a
while without stopping the tail.

- `filterStream(stream, on)`: with `on` true, hides the stream from now on; with `on`
  false, shows it again. The stream needn't exist yet, and hiding or showing it twice
  changes nothing. An empty stream fails.
  - A hidden stream's lines are never returned, and `hasNext` and `skipUntil` ignore
    them: `skipUntil` doesn't count them.
  - Hiding passes over lines rather than holding them back: when the stream is shown
    again, its lines that now come before the position are never returned. Its lines
    after the position are, in the usual order.
  - `addLine` works on a hidden stream exactly as on any other.
