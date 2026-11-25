"use strict";

const TOKEN = "[a-z0-9][a-z0-9.+-]*";
const CONTENT_TYPE = new RegExp(`^${TOKEN}/${TOKEN}$`);
const MEDIA_RANGE = new RegExp(`^(?:\\*/\\*|${TOKEN}/\\*|${TOKEN}/${TOKEN})$`);
const QUALITY = /^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

// A codec turns a flat record into text: encode(fields) gets [name, value] pairs sorted by
// name, so every codec writes them in the same order.
class JsonCodec {
  encode(fields) {
    const quoted = (text) =>
      `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    return `{${fields.map(([k, v]) => `${quoted(k)}:${quoted(v)}`).join(",")}}`;
  }
}

class FormCodec {
  encode(fields) {
    const escaped = (text) =>
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

class CsvCodec {
  encode(fields) {
    const cell = (text) =>
      text.includes(",") || text.includes('"')
        ? `"${text.replaceAll('"', '""')}"`
        : text;
    const header = fields.map(([k]) => cell(k)).join(",");
    return `${header}\n${fields.map(([, v]) => cell(v)).join(",")}`;
  }
}

// The factory method's table: a codec's name makes its codec, and nothing else in the
// registry knows the concrete classes. A new format is a class and a line here.
const CODECS = new Map([
  ["json", () => new JsonCodec()],
  ["form", () => new FormCodec()],
  ["csv", () => new CsvCodec()],
]);

function makeCodec(name) {
  const made = CODECS.get(name);
  if (made === undefined) throw new RangeError("unknown codec");
  return made();
}

// A q-value in thousandths, so no float is ever compared.
function quality(text) {
  if (!QUALITY.test(text)) throw new RangeError("bad q-value");
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
}

function parseRanges(accept) {
  const ranges = new Map();
  for (const item of accept.split(",")) {
    const parts = item.split(";").map((p) => p.replace(/^ +| +$/g, ""));
    const media = parts[0];
    if (!MEDIA_RANGE.test(media) || ranges.has(media) || parts.length > 2)
      throw new RangeError("bad media range");
    let q = 1000;
    if (parts.length === 2) {
      if (!parts[1].startsWith("q=")) throw new RangeError("only q is allowed");
      q = quality(parts[1].slice(2));
    }
    ranges.set(media, q);
  }
  return ranges;
}

class CodecRegistry {
  #codecs = new Map(); // in the order they were added
  #fallback = null;

  add(contentType, codec) {
    if (!CONTENT_TYPE.test(contentType))
      throw new RangeError("bad content type");
    if (this.#codecs.has(contentType)) throw new RangeError("already added");
    this.#codecs.set(contentType, makeCodec(codec));
  }

  negotiate(accept) {
    const ranges = parseRanges(accept);
    let best = null;
    let bestQuality = 0;
    for (const contentType of this.#codecs.keys()) {
      // The most specific range that matches decides, even when it says q=0.
      const top = contentType.split("/")[0];
      const range = [contentType, `${top}/*`, "*/*"].find((r) => ranges.has(r));
      const q = range === undefined ? 0 : ranges.get(range);
      if (q > bestQuality) {
        best = contentType;
        bestQuality = q;
      }
    }
    return best ?? this.#fallback;
  }

  encodeWith(contentType, fields) {
    const codec = this.#codecs.get(contentType);
    if (codec === undefined) throw new RangeError("no codec for that type");
    const entries = Object.entries(fields);
    if (entries.length === 0 || entries.some(([k, v]) => k === "" || v === ""))
      throw new RangeError("empty record, name or value");
    return codec.encode(
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }

  // The extension round: a type to answer with when nothing is acceptable.
  fallbackType(contentType) {
    if (!this.#codecs.has(contentType))
      throw new RangeError("no codec for that type");
    this.#fallback = contentType;
  }
}

module.exports = { CodecRegistry };
