const EARLIEST = 0;

type Line = readonly [number, string];

class Stream {
  readonly name: string;
  readonly lines: Line[] = [];
  head = 0; // the first line not yet returned or passed

  constructor(name: string) {
    this.name = name;
  }
}

// Whether (ts, name) comes before (atTs, atName): time first, then stream name.
function before(
  ts: number,
  name: string,
  atTs: number,
  atName: string,
): boolean {
  return ts !== atTs ? ts < atTs : name < atName;
}

// An iterator over many time-ordered streams at once. Its position is the (time, stream)
// of the last line it returned or skipped to; each stream keeps its own head, so lines
// added later slot in without rebuilding anything.
export class LogMerger {
  private readonly streams = new Map<string, Stream>();
  private readonly hidden = new Set<string>();
  private atTs = EARLIEST;
  private atName = "";

  // The stream's first line at or after the position. Lines behind it (skipped, or
  // passed while the stream was hidden) are dropped for good.
  private first(stream: Stream): Line | null {
    for (let i = stream.head; i < stream.lines.length; i++) {
      const line = stream.lines[i];
      if (
        line !== undefined &&
        !before(line[0], stream.name, this.atTs, this.atName)
      ) {
        stream.head = i;
        return line;
      }
    }
    stream.head = stream.lines.length;
    return null;
  }

  private visible(): Stream[] {
    return [...this.streams.keys()]
      .sort()
      .filter((name) => !this.hidden.has(name))
      .map((name) => this.streams.get(name))
      .filter((s): s is Stream => s !== undefined);
  }

  private peek(): { stream: Stream; line: Line } | null {
    let best: { stream: Stream; line: Line } | null = null;
    for (const stream of this.visible()) {
      const line = this.first(stream);
      if (line !== null && (best === null || line[0] < best.line[0]))
        best = { stream, line };
    }
    return best;
  }

  addLine(stream: string, ts: number, line: string): boolean {
    if (stream === "" || line === "" || ts < EARLIEST)
      throw new RangeError("an empty name or line, or a negative time");
    let found = this.streams.get(stream);
    const last = found?.lines.at(-1);
    if (
      (last !== undefined && ts < last[0]) ||
      before(ts, stream, this.atTs, this.atName)
    )
      return false;
    if (found === undefined) {
      found = new Stream(stream);
      this.streams.set(stream, found);
    }
    found.lines.push([ts, line]);
    return true;
  }

  hasNext(): boolean {
    return this.peek() !== null;
  }

  next(): string {
    const best = this.peek();
    if (best === null) throw new RangeError("no more lines");
    best.stream.head++;
    [this.atTs, this.atName] = [best.line[0], best.stream.name];
    return `${String(best.line[0])} ${best.stream.name} ${best.line[1]}`;
  }

  skipUntil(ts: number): number {
    if (ts < EARLIEST) throw new RangeError("a negative time");
    let skipped = 0;
    for (const stream of this.visible()) {
      if (this.first(stream) === null) continue;
      for (const [at] of stream.lines.slice(stream.head))
        if (at < ts) skipped++;
    }
    // Moving the position is the skip: every line behind it is dropped when reached.
    if (before(this.atTs, this.atName, ts, ""))
      [this.atTs, this.atName] = [ts, ""];
    return skipped;
  }

  // The extension round: a hidden stream is passed over, not held back.
  filterStream(stream: string, on: boolean): void {
    if (stream === "") throw new RangeError("an empty stream");
    if (on) this.hidden.add(stream);
    else this.hidden.delete(stream);
  }
}
