"use strict";

const MAX_LAYERS = 8;
const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HEX = "0123456789abcdef";

// What any layer can be given to encode: non-empty printable ASCII.
function isPayload(text) {
  return text !== "" && [...text].every((c) => c >= " " && c <= "~");
}

// The innermost codec: the text as it is.
class Plain {
  encode(text) {
    return text;
  }
  decode(text) {
    return text;
  }
}

// A decorator: it wraps another codec and adds one step on the outside. Decoding accepts
// only what encoding could have produced: whatever unwrap gives back must be a valid
// payload that wraps to exactly the input again. Subclasses give wrap and unwrap.
class Layer {
  constructor(inner) {
    this.inner = inner;
  }
  encode(text) {
    return this.wrap(this.inner.encode(text));
  }
  decode(text) {
    const raw = this.unwrap(text);
    if (!isPayload(raw) || this.wrap(raw) !== text)
      throw new RangeError("not something this layer produced");
    return this.inner.decode(raw);
  }
}

class Base64 extends Layer {
  wrap(text) {
    let out = "";
    for (let i = 0; i < text.length; i += 3) {
      const chunk = [...text.slice(i, i + 3)].map((c) => c.charCodeAt(0));
      const n =
        ((chunk[0] ?? 0) << 16) | ((chunk[1] ?? 0) << 8) | (chunk[2] ?? 0);
      for (let k = 0; k < 4; k++)
        out += k <= chunk.length ? BASE64[(n >> (18 - 6 * k)) & 63] : "=";
    }
    return out;
  }
  unwrap(text) {
    // Lenient on padding and unused bits: decode() re-encodes, which catches both.
    let value = 0;
    let bits = 0;
    let out = "";
    for (const c of text) {
      if (c === "=") break;
      const digit = BASE64.indexOf(c);
      if (digit < 0) throw new RangeError("not base64");
      value = ((value << 6) | digit) & 0xfff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((value >> bits) & 0xff);
      }
    }
    return out;
  }
}

class Hex extends Layer {
  wrap(text) {
    return [...text]
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  }
  unwrap(text) {
    if (text.length % 2 !== 0) throw new RangeError("odd hex");
    let out = "";
    for (let i = 0; i < text.length; i += 2) {
      const hi = HEX.indexOf(text[i]);
      const lo = HEX.indexOf(text[i + 1]);
      if (hi < 0 || lo < 0) throw new RangeError("not hex");
      out += String.fromCharCode(hi * 16 + lo);
    }
    return out;
  }
}

// A length prefix: "<length>:<text>".
class Frame extends Layer {
  wrap(text) {
    return `${text.length}:${text}`;
  }
  unwrap(text) {
    const colon = text.indexOf(":");
    return colon < 0 ? "" : text.slice(colon + 1);
  }
}

// The extension's layer: one check digit, the sum of the character codes mod 10.
class Checksum extends Layer {
  wrap(text) {
    let sum = 0;
    for (const c of text) sum += c.charCodeAt(0);
    return text + String(sum % 10);
  }
  unwrap(text) {
    return text.slice(0, -1);
  }
}

const LAYERS = new Map([
  ["base64", Base64],
  ["hex", Hex],
  ["frame", Frame],
]);

class PayloadPipeline {
  constructor() {
    this.codec = new Plain();
    this.names = [];
  }

  push(layer) {
    const found = LAYERS.get(layer);
    if (found === undefined) throw new RangeError("unknown layer");
    this.add(layer, found);
  }

  encode(text) {
    if (!isPayload(text)) throw new RangeError("not a payload");
    return this.codec.encode(text);
  }

  decode(text) {
    if (!isPayload(text)) throw new RangeError("not a payload");
    return this.codec.decode(text);
  }

  layers() {
    return [...this.names];
  }

  // The extension round: a layer that catches corruption.
  checksum() {
    this.add("checksum", Checksum);
  }

  add(name, Kind) {
    if (this.names.length >= MAX_LAYERS)
      throw new RangeError("too many layers");
    this.codec = new Kind(this.codec);
    this.names.push(name);
  }
}

module.exports = { PayloadPipeline };
