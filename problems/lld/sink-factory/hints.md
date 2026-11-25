> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

Once a sink exists, does `writeLine` need to know which kind it is, or could the sink itself know how it writes?

## Approach

Give every kind of sink the same small interface: its kind and a write that returns what it wrote. Each kind is its own class holding only what it needs (a file sink keeps its path and its own line counter). One factory function is the only code that reads spec strings: it matches each spec form, builds the matching class, and fails on anything else. The factory class stores each new sink under a generated id and keeps a count per kind; `kindOf` and `writeLine` look the sink up and ask it. A new kind later means a new class plus one way to make it, and nothing that writes changes.

## Code sketch

```text
interface Sink
  kind() -> string
  write(line) -> string

class StdoutSink, FileSink(path), SyslogSink(host, port)
  // TODO: each writes in its own format

parse(spec) -> Sink
  // TODO: "stdout", "file:<path>", "syslog:<host>:<port>"
  // TODO: fail on anything else

class SinkFactory
  sinks: map id -> Sink
  made: map kind -> int

  create(spec) -> string
    // TODO: sink = parse(spec); count its kind; id = kind-n
  kindOf(id) -> string
  writeLine(id, line) -> string
    // TODO: look up first, then check the line
  created(kind) -> int
```
