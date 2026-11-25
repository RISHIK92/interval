const MAX_LAYERS = 8;
const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HEX = "0123456789abcdef";

// What any layer can be given to encode: non-empty printable ASCII.
function isPayload(text: string): boolean {
  return text !== "" && [...text].every((c) => c >= " " && c <= "~");
}

interface Codec {
  encode(text: string): string;
  decode(text: string): string;
}

// The innermost codec: the text as it is.
class Plain implements Codec {
  encode(text: string): string {
    return text;
  }
  decode(text: string): string {
    return text;
  }
}

// A decorator: it wraps another codec and adds one step on the outside. Decoding accepts
// only what encoding could have produced: whatever unwrap gives back must be a valid
// payload that wraps to exactly the input again.
abstract class Layer implements Codec {
  private readonly inner: Codec;

  constructor(inner: Codec) {
    this.inner = inner;
  }

  abstract wrap(text: string): string;
  abstract unwrap(text: string): string;

  encode(text: string): string {
    return this.wrap(this.inner.encode(text));
  }

  decode(text: string): string {
    const raw = this.unwrap(text);
    if (!isPayload(raw) || this.wrap(raw) !== text)
      throw new RangeError("not something this layer produced");
    return this.inner.decode(raw);
  }
}

class Base64 extends Layer {
  wrap(text: string): string {
    let out = "";
    for (let i = 0; i < text.length; i += 3) {
      const chunk = [...text.slice(i, i + 3)].map((c) => c.charCodeAt(0));
      const n =
        ((chunk[0] ?? 0) << 16) | ((chunk[1] ?? 0) << 8) | (chunk[2] ?? 0);
      for (let k = 0; k < 4; k++)
        out +=
          k <= chunk.length ? BASE64.charAt((n >> (18 - 6 * k)) & 63) : "=";
    }
    return out;
  }
  unwrap(text: string): string {
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
  wrap(text: string): string {
    return [...text]
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  }
  unwrap(text: string): string {
    if (text.length % 2 !== 0) throw new RangeError("odd hex");
    let out = "";
    for (let i = 0; i < text.length; i += 2) {
      const hi = HEX.indexOf(text.charAt(i));
      const lo = HEX.indexOf(text.charAt(i + 1));
      if (hi < 0 || lo < 0) throw new RangeError("not hex");
      out += String.fromCharCode(hi * 16 + lo);
    }
    return out;
  }
}

// A length prefix: "<length>:<text>".
class Frame extends Layer {
  wrap(text: string): string {
    return `${text.length}:${text}`;
  }
  unwrap(text: string): string {
    const colon = text.indexOf(":");
    return colon < 0 ? "" : text.slice(colon + 1);
  }
}

// The extension's layer: one check digit, the sum of the character codes mod 10.
class Checksum extends Layer {
  wrap(text: string): string {
    let sum = 0;
    for (const c of text) sum += c.charCodeAt(0);
    return text + String(sum % 10);
  }
  unwrap(text: string): string {
    return text.slice(0, -1);
  }
}

type LayerKind = new (inner: Codec) => Layer;

const LAYERS = new Map<string, LayerKind>([
  ["base64", Base64],
  ["hex", Hex],
  ["frame", Frame],
]);

export class PayloadPipeline {
  private codec: Codec = new Plain();
  private readonly names: string[] = [];

  push(layer: string): void {
    const found = LAYERS.get(layer);
    if (found === undefined) throw new RangeError("unknown layer");
    this.add(layer, found);
  }

  encode(text: string): string {
    if (!isPayload(text)) throw new RangeError("not a payload");
    return this.codec.encode(text);
  }

  decode(text: string): string {
    if (!isPayload(text)) throw new RangeError("not a payload");
    return this.codec.decode(text);
  }

  layers(): string[] {
    return [...this.names];
  }

  // The extension round: a layer that catches corruption.
  checksum(): void {
    this.add("checksum", Checksum);
  }

  private add(name: string, kind: LayerKind): void {
    if (this.names.length >= MAX_LAYERS)
      throw new RangeError("too many layers");
    this.codec = new kind(this.codec);
    this.names.push(name);
  }
}
