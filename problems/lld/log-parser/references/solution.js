"use strict";

const ACCESS =
  /^([^ ]+) ([^ ]+) ([^ ]+) \[([^\]]+)\] "([^ "]+) ([^ "]+) ([^ "]+)" ([0-9]{3}) ([0-9]+|-)$/;
const ACCESS_KEYS = [
  "host",
  "ident",
  "user",
  "time",
  "method",
  "path",
  "protocol",
  "status",
  "bytes",
];

// One named way to read a line. Each kind reads it its own way: fields(line) gives the
// fields, or null when the line is malformed for that kind.
class Format {
  count = 0;
}

class KeyValueFormat extends Format {
  fields(line) {
    const out = {};
    for (const token of line.split(" ")) {
      const at = token.indexOf("=");
      if (at <= 0) return null;
      const key = token.slice(0, at);
      if (Object.hasOwn(out, key)) return null;
      out[key] = token.slice(at + 1);
    }
    return out;
  }
}

class CsvFormat extends Format {
  #headers;

  constructor(headers) {
    super();
    this.#headers = [...headers];
  }

  fields(line) {
    const values = line.split(",");
    if (values.length !== this.#headers.length) return null;
    return Object.fromEntries(this.#headers.map((h, i) => [h, values[i]]));
  }
}

class AccessFormat extends Format {
  fields(line) {
    const match = ACCESS.exec(line);
    if (match === null) return null;
    return Object.fromEntries(ACCESS_KEYS.map((k, i) => [k, match[i + 1]]));
  }
}

class LogParser {
  #formats = new Map();

  #format(name) {
    const format = this.#formats.get(name);
    if (format === undefined) throw new RangeError("no such format");
    return format;
  }

  addFormat(name, kind, headers) {
    if (name === "" || this.#formats.has(name))
      throw new RangeError("a format needs a new, non-empty name");
    let format;
    if (kind === "csv") {
      if (
        headers.length < 1 ||
        headers.length > 20 ||
        headers.includes("") ||
        new Set(headers).size !== headers.length
      )
        throw new RangeError("1-20 distinct, non-empty headers");
      format = new CsvFormat(headers);
    } else if (kind === "kv" && headers.length === 0)
      format = new KeyValueFormat();
    else if (kind === "access" && headers.length === 0)
      format = new AccessFormat();
    else throw new RangeError("unknown kind, or headers where none are taken");
    this.#formats.set(name, format);
  }

  parse(format, line) {
    const chosen = this.#format(format);
    const fields = chosen.fields(line);
    if (fields === null) throw new RangeError("malformed line");
    chosen.count += 1;
    return fields;
  }

  parsed(format) {
    return this.#format(format).count;
  }

  // The extension round.
  detect(line) {
    for (const [name, candidate] of this.#formats)
      if (candidate.fields(line) !== null) return name;
    return null;
  }
}

module.exports = { LogParser };
