const TOKEN = "[a-z0-9][a-z0-9.+-]*";
const CONTENT_TYPE = new RegExp(`^${TOKEN}/${TOKEN}$`);
const MEDIA_RANGE = new RegExp(`^(?:\\*/\\*|${TOKEN}/\\*|${TOKEN}/${TOKEN})$`);
const QUALITY = /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

type Fields = [string, string][];

// What the registry needs from a codec: turn a flat record into text. Fields arrive
// sorted by name, so every codec writes them in the same order.
interface Codec {
  encode(fields: Fields): string;
}

class JsonCodec implements Codec {
  encode(fields: Fields): string {
    const quoted = (text: string) =>
      `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    return `{${fields.map(([k, v]) => `${quoted(k)}:${quoted(v)}`).join(",")}}`;
  }
}

class FormCodec implements Codec {
  encode(fields: Fields): string {
    const escaped = (text: string) =>
      [...text]
        .map((c) =>
          UNRESERVED.test(c)
            ? c
            : `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
        )
        .join("");
    return fields.map(([k, v]) => `${escaped(k)}=${escaped(v)}`).join("&");
  }
}

class CsvCodec implements Codec {
  encode(fields: Fields): string {
    const cell = (text: string) =>
      text.includes(",") || text.includes('"')
        ? `"${text.replaceAll('"', '""')}"`
        : text;
    const header = fields.map(([k]) => cell(k)).join(",");
    return `${header}\n${fields.map(([, v]) => cell(v)).join(",")}`;
  }
}

// The factory method's table: a codec's name makes its codec, and nothing else in the
// registry knows the concrete classes. A new format is a class and a line here.
const CODECS = new Map<string, () => Codec>([
  ["json", () => new JsonCodec()],
  ["form", () => new FormCodec()],
  ["csv", () => new CsvCodec()],
]);

function makeCodec(name: string): Codec {
  const made = CODECS.get(name);
  if (made === undefined) throw new RangeError("unknown codec");
  return made();
}

// A q-value in thousandths, so no float is ever compared.
function quality(text: string): number {
  if (!QUALITY.test(text)) throw new RangeError("bad q-value");
  const [whole = "", fraction = ""] = text.split(".");
  return Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
}

function parseRanges(accept: string): Map<string, number> {
  const ranges = new Map<string, number>();
  for (const item of accept.split(",")) {
    const parts = item.split(";").map((p) => p.replace(/^ +| +$/g, ""));
    const media = parts[0] ?? "";
    if (!MEDIA_RANGE.test(media) || ranges.has(media) || parts.length > 2)
      throw new RangeError("bad media range");
    let q = 1000;
    const parameter = parts[1];
    if (parameter !== undefined) {
      if (!parameter.startsWith("q="))
        throw new RangeError("only q is allowed");
      q = quality(parameter.slice(2));
    }
    ranges.set(media, q);
  }
  return ranges;
}

export class CodecRegistry {
  private readonly codecs = new Map<string, Codec>(); // in the order they were added
  private fallback: string | null = null;

  add(contentType: string, codec: string): void {
    if (!CONTENT_TYPE.test(contentType))
      throw new RangeError("bad content type");
    if (this.codecs.has(contentType)) throw new RangeError("already added");
    this.codecs.set(contentType, makeCodec(codec));
  }

  negotiate(accept: string): string | null {
    const ranges = parseRanges(accept);
    let best: string | null = null;
    let bestQuality = 0;
    for (const contentType of this.codecs.keys()) {
      // The most specific range that matches decides, even when it says q=0.
      const top = contentType.split("/")[0] ?? "";
      const range = [contentType, `${top}/*`, "*/*"].find((r) => ranges.has(r));
      const q = range === undefined ? 0 : (ranges.get(range) ?? 0);
      if (q > bestQuality) {
        best = contentType;
        bestQuality = q;
      }
    }
    return best ?? this.fallback;
  }

  encodeWith(contentType: string, fields: Record<string, string>): string {
    const codec = this.codecs.get(contentType);
    if (codec === undefined) throw new RangeError("no codec for that type");
    const entries = Object.entries(fields);
    if (entries.length === 0 || entries.some(([k, v]) => k === "" || v === ""))
      throw new RangeError("empty record, name or value");
    return codec.encode(
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }

  // The extension round: a type to answer with when nothing is acceptable.
  fallbackType(contentType: string): void {
    if (!this.codecs.has(contentType))
      throw new RangeError("no codec for that type");
    this.fallback = contentType;
  }
}
