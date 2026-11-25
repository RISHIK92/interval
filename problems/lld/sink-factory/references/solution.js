"use strict";

const FILE = /^file:(\/[^ ]*)$/;
const SYSLOG = /^syslog:([A-Za-z0-9.-]+):([1-9][0-9]{0,4})$/;
const PORT_LIMIT = 65535;

function filled(text) {
  if (text === "") throw new RangeError("not empty");
}

// Every product of the factory has a kind and write(line). Callers hold a sink id and
// never learn which class is behind it.

class StdoutSink {
  kind = "stdout";

  write(line) {
    return line;
  }
}

class FileSink {
  kind = "file";
  #path;
  #written = 0;

  constructor(path) {
    this.#path = path;
  }

  write(line) {
    this.#written += 1;
    return `${this.#path}:${this.#written} ${line}`;
  }
}

class SyslogSink {
  kind = "syslog";
  #address;

  constructor(host, port) {
    this.#address = `${host}:${port}`;
  }

  write(line) {
    return `<14>${this.#address} ${line}`;
  }
}

class BufferedSink {
  kind = "buffered";
  #capacity;
  #held = [];

  constructor(capacity) {
    this.#capacity = capacity;
  }

  write(line) {
    this.#held.push(line);
    if (this.#held.length > this.#capacity) this.#held.shift();
    return "";
  }

  drain() {
    const out = this.#held;
    this.#held = [];
    return out;
  }
}

// The creation step, a parameterised factory (the simple form of factory method): the
// spec decides which class to make, and only here.
function parse(spec) {
  if (spec === "stdout") return new StdoutSink();
  const file = FILE.exec(spec);
  if (file !== null && !spec.endsWith("/")) return new FileSink(file[1]);
  const syslog = SYSLOG.exec(spec);
  if (syslog !== null && Number(syslog[2]) <= PORT_LIMIT)
    return new SyslogSink(syslog[1], Number(syslog[2]));
  throw new RangeError("malformed spec");
}

class SinkFactory {
  #sinks = new Map();
  #made = new Map();

  #keep(sink) {
    const number = (this.#made.get(sink.kind) ?? 0) + 1;
    this.#made.set(sink.kind, number);
    const id = `${sink.kind}-${number}`;
    this.#sinks.set(id, sink);
    return id;
  }

  #find(sink) {
    const found = this.#sinks.get(sink);
    if (found === undefined) throw new RangeError("unknown sink");
    return found;
  }

  create(spec) {
    return this.#keep(parse(spec));
  }

  kindOf(sink) {
    return this.#find(sink).kind;
  }

  writeLine(sink, line) {
    const found = this.#find(sink);
    filled(line);
    return found.write(line);
  }

  created(kind) {
    filled(kind);
    return this.#made.get(kind) ?? 0;
  }

  // The extension round: one more product, made by its own method.
  createBuffered(capacity) {
    if (capacity < 1 || capacity > 1000)
      throw new RangeError("capacity is 1 to 1000");
    return this.#keep(new BufferedSink(capacity));
  }

  flush(sink) {
    const found = this.#find(sink);
    if (!(found instanceof BufferedSink))
      throw new RangeError("only a buffered sink holds lines");
    return found.drain();
  }
}

module.exports = { SinkFactory };
