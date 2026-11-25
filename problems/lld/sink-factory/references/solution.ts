const FILE = /^file:(\/[^ ]*)$/;
const SYSLOG = /^syslog:([A-Za-z0-9.-]+):([1-9][0-9]{0,4})$/;
const PORT_LIMIT = 65535;

function filled(text: string): void {
  if (text === "") throw new RangeError("not empty");
}

// What every product of the factory can do. Callers hold a sink id and never learn which
// class is behind it.
interface Sink {
  readonly kind: string;
  write(line: string): string;
}

class StdoutSink implements Sink {
  readonly kind = "stdout";

  write(line: string): string {
    return line;
  }
}

class FileSink implements Sink {
  readonly kind = "file";
  private readonly path: string;
  private written = 0;

  constructor(path: string) {
    this.path = path;
  }

  write(line: string): string {
    this.written += 1;
    return `${this.path}:${String(this.written)} ${line}`;
  }
}

class SyslogSink implements Sink {
  readonly kind = "syslog";
  private readonly address: string;

  constructor(host: string, port: number) {
    this.address = `${host}:${String(port)}`;
  }

  write(line: string): string {
    return `<14>${this.address} ${line}`;
  }
}

class BufferedSink implements Sink {
  readonly kind = "buffered";
  private readonly capacity: number;
  private held: string[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  write(line: string): string {
    this.held.push(line);
    if (this.held.length > this.capacity) this.held.shift();
    return "";
  }

  drain(): string[] {
    const out = this.held;
    this.held = [];
    return out;
  }
}

// The creation step, a parameterised factory (the simple form of factory method): the
// spec decides which class to make, and only here.
function parse(spec: string): Sink {
  if (spec === "stdout") return new StdoutSink();
  const file = FILE.exec(spec);
  if (file !== null && !spec.endsWith("/")) return new FileSink(file[1] ?? "");
  const syslog = SYSLOG.exec(spec);
  if (syslog !== null && Number(syslog[2]) <= PORT_LIMIT)
    return new SyslogSink(syslog[1] ?? "", Number(syslog[2]));
  throw new RangeError("malformed spec");
}

export class SinkFactory {
  private readonly sinks = new Map<string, Sink>();
  private readonly made = new Map<string, number>();

  private keep(sink: Sink): string {
    const number = (this.made.get(sink.kind) ?? 0) + 1;
    this.made.set(sink.kind, number);
    const id = `${sink.kind}-${String(number)}`;
    this.sinks.set(id, sink);
    return id;
  }

  private find(sink: string): Sink {
    const found = this.sinks.get(sink);
    if (found === undefined) throw new RangeError("unknown sink");
    return found;
  }

  create(spec: string): string {
    return this.keep(parse(spec));
  }

  kindOf(sink: string): string {
    return this.find(sink).kind;
  }

  writeLine(sink: string, line: string): string {
    const found = this.find(sink);
    filled(line);
    return found.write(line);
  }

  created(kind: string): number {
    filled(kind);
    return this.made.get(kind) ?? 0;
  }

  // The extension round: one more product, made by its own method.
  createBuffered(capacity: number): string {
    if (capacity < 1 || capacity > 1000)
      throw new RangeError("capacity is 1 to 1000");
    return this.keep(new BufferedSink(capacity));
  }

  flush(sink: string): string[] {
    const found = this.find(sink);
    if (!(found instanceof BufferedSink))
      throw new RangeError("only a buffered sink holds lines");
    return found.drain();
  }
}
