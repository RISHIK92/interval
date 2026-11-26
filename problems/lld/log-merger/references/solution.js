"use strict";

const EARLIEST = 0;

class Stream {
  constructor(name) {
    this.name = name;
    this.lines = []; // [ts, text] pairs
    this.head = 0; // the first line not yet returned or passed
  }
}

// Whether (ts, name) comes before (atTs, atName): time first, then stream name.
function before(ts, name, atTs, atName) {
  return ts !== atTs ? ts < atTs : name < atName;
}

// An iterator over many time-ordered streams at once. Its position is the (time, stream)
// of the last line it returned or skipped to; each stream keeps its own head, so lines
// added later slot in without rebuilding anything.
class LogMerger {
  #streams = new Map();
  #hidden = new Set();
  #atTs = EARLIEST;
  #atName = "";

  // The stream's first line at or after the position. Lines behind it (skipped, or
  // passed while the stream was hidden) are dropped for good.
  #first(stream) {
    for (let i = stream.head; i < stream.lines.length; i++) {
      const line = stream.lines[i];
      if (!before(line[0], stream.name, this.#atTs, this.#atName)) {
        stream.head = i;
        return line;
      }
    }
    stream.head = stream.lines.length;
    return null;
  }

  #visible() {
    return [...this.#streams.keys()]
      .sort()
      .filter((name) => !this.#hidden.has(name))
      .map((name) => this.#streams.get(name));
  }

  #peek() {
    let best = null;
    for (const stream of this.#visible()) {
      const line = this.#first(stream);
      if (line !== null && (best === null || line[0] < best.line[0]))
        best = { stream, line };
    }
    return best;
  }

  addLine(stream, ts, line) {
    if (stream === "" || line === "" || ts < EARLIEST)
      throw new RangeError("an empty name or line, or a negative time");
    const found = this.#streams.get(stream);
    const last = found?.lines.at(-1);
    if (
      (last !== undefined && ts < last[0]) ||
      before(ts, stream, this.#atTs, this.#atName)
    )
      return false;
    if (found === undefined) this.#streams.set(stream, new Stream(stream));
    this.#streams.get(stream).lines.push([ts, line]);
    return true;
  }

  hasNext() {
    return this.#peek() !== null;
  }

  next() {
    const best = this.#peek();
    if (best === null) throw new RangeError("no more lines");
    best.stream.head++;
    this.#atTs = best.line[0];
    this.#atName = best.stream.name;
    return `${best.line[0]} ${best.stream.name} ${best.line[1]}`;
  }

  skipUntil(ts) {
    if (ts < EARLIEST) throw new RangeError("a negative time");
    let skipped = 0;
    for (const stream of this.#visible()) {
      if (this.#first(stream) === null) continue;
      for (const [at] of stream.lines.slice(stream.head))
        if (at < ts) skipped++;
    }
    // Moving the position is the skip: every line behind it is dropped when reached.
    if (before(this.#atTs, this.#atName, ts, "")) {
      this.#atTs = ts;
      this.#atName = "";
    }
    return skipped;
  }

  // The extension round: a hidden stream is passed over, not held back.
  filterStream(stream, on) {
    if (stream === "") throw new RangeError("an empty stream");
    if (on) this.#hidden.add(stream);
    else this.#hidden.delete(stream);
  }
}

module.exports = { LogMerger };
