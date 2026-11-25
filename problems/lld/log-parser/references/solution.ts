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

type Fields = Record<string, string>;

// One named way to read a line. Each kind reads it its own way.
abstract class Format {
  count = 0;
  // The line's fields, or null when it's malformed for this kind.
  abstract fields(line: string): Fields | null;
}

class KeyValueFormat extends Format {
  fields(line: string): Fields | null {
    const out = new Map<string, string>();
    for (const token of line.split(" ")) {
      const at = token.indexOf("=");
      if (at <= 0) return null;
      const key = token.slice(0, at);
      if (out.has(key)) return null;
      out.set(key, token.slice(at + 1));
    }
    return Object.fromEntries(out);
  }
}

class CsvFormat extends Format {
  private readonly headers: string[];

  constructor(headers: string[]) {
    super();
    this.headers = [...headers];
  }

  fields(line: string): Fields | null {
    const values = line.split(",");
    if (values.length !== this.headers.length) return null;
    return Object.fromEntries(this.headers.map((h, i) => [h, values[i] ?? ""]));
  }
}

class AccessFormat extends Format {
  fields(line: string): Fields | null {
    const match = ACCESS.exec(line);
    if (match === null) return null;
    return Object.fromEntries(
      ACCESS_KEYS.map((k, i) => [k, match[i + 1] ?? ""]),
    );
  }
}

export class LogParser {
  private readonly formats = new Map<string, Format>();

  private format(name: string): Format {
    const format = this.formats.get(name);
    if (format === undefined) throw new RangeError("no such format");
    return format;
  }

  addFormat(name: string, kind: string, headers: string[]): void {
    if (name === "" || this.formats.has(name))
      throw new RangeError("a format needs a new, non-empty name");
    let format: Format;
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
    this.formats.set(name, format);
  }

  parse(format: string, line: string): Fields {
    const chosen = this.format(format);
    const fields = chosen.fields(line);
    if (fields === null) throw new RangeError("malformed line");
    chosen.count += 1;
    return fields;
  }

  parsed(format: string): number {
    return this.format(format).count;
  }

  // The extension round.
  detect(line: string): string | null {
    for (const [name, candidate] of this.formats)
      if (candidate.fields(line) !== null) return name;
    return null;
  }
}
