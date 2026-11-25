"use strict";

// The legacy agent's units, each as how many of the new API's base units it is.
const TIME_UNITS = new Map([
  ["s", 1000],
  ["ms", 1],
  ["us", 0.001],
]);
const SIZE_UNITS = new Map([
  ["B", 1],
  ["KB", 1024],
  ["MB", 1024 * 1024],
]);

// The new metrics API: it knows only milliseconds and bytes, and each name is one or the
// other.
class MetricsApi {
  #ms = new Map();
  #bytes = new Map();

  recordMs(name, ms) {
    if (this.#bytes.has(name)) return false;
    this.#ms.set(name, ms);
    return true;
  }

  recordBytes(name, size) {
    if (this.#ms.has(name)) return false;
    this.#bytes.set(name, size);
    return true;
  }

  ms(name) {
    return this.#ms.get(name) ?? null;
  }

  size(name) {
    return this.#bytes.get(name) ?? null;
  }

  names() {
    return [...this.#ms.keys(), ...this.#bytes.keys()].sort();
  }
}

function named(name) {
  if (name === "") throw new RangeError("empty name");
}

// Speaks the legacy agent's `name value unit` lines and feeds the new API: the only code
// that knows the old format and units.
class MetricsAdapter {
  #api = new MetricsApi();

  ingestLegacy(line) {
    if (line === "") throw new RangeError("empty line");
    return this.#ingest(line);
  }

  gaugeMs(name) {
    named(name);
    return this.#api.ms(name);
  }

  gaugeBytes(name) {
    named(name);
    return this.#api.size(name);
  }

  names() {
    return this.#api.names();
  }

  // The extension round: a batch of lines, each as ingestLegacy takes it.
  ingestBatch(lines) {
    return lines.filter((line) => this.#ingest(line)).length;
  }

  #ingest(line) {
    const fields = line.split(" ");
    if (fields.length !== 3) return false;
    const [name, text, unit] = fields;
    if (name === "" || !/^[0-9]{1,9}$/.test(text)) return false;
    const value = Number(text);
    const ms = TIME_UNITS.get(unit);
    if (ms !== undefined) return this.#api.recordMs(name, value * ms);
    const bytes = SIZE_UNITS.get(unit);
    if (bytes !== undefined) return this.#api.recordBytes(name, value * bytes);
    return false;
  }
}

module.exports = { MetricsAdapter };
